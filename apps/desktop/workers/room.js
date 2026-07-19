'use strict'

const EventEmitter = require('bare-events')

const Autobase = require('autobase')
const b4a = require('b4a')
const BlindPairing = require('blind-pairing')
const crypto = require('hypercore-crypto')
const Hypercore = require('hypercore')

const {
  createAdmissionClaim,
  decodeAdmissionResponse,
  encodeAdmissionResponse
} = require('../lib/admission-claim.js')
const { encodeBaseInvite, parseInviteCode, previewBytes } = require('../lib/invite-code.js')
const {
  decodeCandidateData,
  encodeCandidateData,
  signMemberBinding,
  userIdFromPublicKey
} = require('../lib/room-identity.js')
const { EncryptedMediaStore, validateMediaDescriptor } = require('../lib/encrypted-media.js')
const { keyAgreementKeyPairFromIdentity, signMemberKeyAgreement } = require('../lib/member-crypto.js')
const { createEncryptedReport, openEncryptedReport } = require('../lib/moderation-report.js')
const { createOperation, operationId } = require('../lib/room-operations.js')
const {
  MAX_ROOM_MODERATORS,
  PAIRING_TIMEOUT_MS,
  ROOM_DATA_EPOCH,
  ROOM_DISCOVERY_REFRESH_MS
} = require('../lib/room-constants.js')
const {
  applyRoomNodes,
  closeRoomView,
  openRoomView,
  projectHistoryPage,
  projectRoom,
  projectThreadPage,
  scan,
  valueAt
} = require('./room-view.js')

const APPLY_TIMEOUT_MS = 10_000

class Room extends EventEmitter {
  constructor ({
    rootStore,
    swarm,
    pairing,
    account,
    roomId,
    bootstrapKey = null,
    encryptionKey = null,
    localKeyPair = null,
    admissionClaim = null,
    operationClock = Date.now
  }) {
    super()
    this.rootStore = rootStore
    this.swarm = swarm
    this.pairing = pairing
    this.account = account
    this.roomId = roomId
    this.bootstrapKey = bootstrapKey
    this.encryptionKey = encryptionKey
    this.localKeyPair = localKeyPair
    this.admissionClaim = admissionClaim
    if (typeof operationClock !== 'function') throw new TypeError('Room operation clock must be a function')
    this.operationClock = operationClock

    this.store = rootStore.namespace(`fulltime-room-v1/${roomId}`)
    this.base = null
    this.discovery = null
    this.pairMember = null
    this.presence = new Map()
    this.media = null
    this.mediaEpoch = null
    this._mediaOpening = null
    this.opened = false
    this.closed = false
    this._refreshing = null
    this._writableHeadFlushed = false
    this._lastDiscoveryRefreshAt = 0
    this._onBaseUpdateBound = this._onBaseUpdate.bind(this)
    this._onBaseErrorBound = this._onBaseError.bind(this)
  }

  get view () {
    if (!this.base) throw new Error('Room is not open')
    return this.base.view
  }

  async open ({ requireWritable = false, requireMembership = false, waitForUpdate = true } = {}) {
    if (this.opened) return
    if (this.closed) throw new Error('Room is closed locally')

    this.base = new Autobase(this.store, this.bootstrapKey, {
      encrypt: true,
      encrypted: true,
      ...(this.encryptionKey ? { encryptionKey: this.encryptionKey } : {}),
      ...(this.localKeyPair ? { keyPair: this.localKeyPair } : {}),
      ackInterval: 10_000,
      optimistic: true,
      valueEncoding: 'json',
      open: openRoomView,
      apply: applyRoomNodes,
      close: closeRoomView
    })
    this.base.on('update', this._onBaseUpdateBound)
    this.base.on('writable', this._onBaseUpdateBound)
    this.base.on('unwritable', this._onBaseUpdateBound)
    this.base.on('error', this._onBaseErrorBound)
    await this.base.ready()

    this.discovery = this.swarm.join(this.base.discoveryKey, {
      server: true,
      client: true,
      limit: 64
    })
    await this.discovery.flushed()
    if (waitForUpdate) {
      await this.base.update()
    } else {
      // A stored room already has a durable local Autobase view. Do not block
      // the desktop command plane on remote-writer catch-up during startup;
      // Autobase will emit an update when that network work completes.
      void this.base.update().catch(this._onBaseErrorBound)
    }
    if (this.admissionClaim) await this._applyAdmissionClaim()
    if (requireWritable) await this.waitForWritable()
    if (requireMembership) await this.waitForMembership()
    this.opened = true
    if (await valueAt(this.view, 'meta/room')) {
      if (await this._hasLocalMembership()) await this._ensureKeyAgreementBinding()
      await this.refresh()
    }
  }

  async waitForWritable (timeoutMs = PAIRING_TIMEOUT_MS) {
    if (this.base.writable) return
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await this.base.update()
      if (this.base.writable) return
      await delay(50)
    }
    throw new Error('Timed out waiting for room write access')
  }

  async waitForMembership (timeoutMs = PAIRING_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs
    const userId = userIdFromPublicKey(this.account.identityKeyPair.publicKey)
    const writerKey = b4a.toString(this.base.local.key, 'hex')
    let member = null
    while (Date.now() < deadline) {
      await this.base.update()
      member = await valueAt(this.view, `member/${userId}`)
      if (member?.active && !member.banned && member.writerKey === writerKey) return
      await delay(50)
    }
    throw new Error(`Timed out waiting for room membership (localWriter=${writerKey}, member=${member ? member.writerKey : 'missing'}, writable=${this.base.writable}, length=${this.base.length}, signedLength=${this.base.signedLength})`)
  }

  async close () {
    if (this.closed) return
    this.closed = true
    this.opened = false
    if (this.base) {
      this.base.removeListener('update', this._onBaseUpdateBound)
      this.base.removeListener('writable', this._onBaseUpdateBound)
      this.base.removeListener('unwritable', this._onBaseUpdateBound)
      this.base.removeListener('error', this._onBaseErrorBound)
    }
    await this._refreshing?.catch(() => {})
    await this.media?.close().catch(() => {})
    this.media = null
    this.mediaEpoch = null
    this._mediaOpening = null
    await this.pairMember?.close().catch(() => {})
    this.pairMember = null
    await this.discovery?.destroy().catch(() => {})
    this.discovery = null
    await this.base?.close().catch(() => {})
    this.base = null
    await this.store.close().catch(() => {})
    this.removeAllListeners()
  }

  async restart ({
    bootstrapKey = this.base?.key,
    encryptionKey = this.base?.encryptionKey,
    localKeyPair = null,
    admissionClaim = null,
    requireWritable = false,
    requireMembership = false
  } = {}) {
    if (this.closed) throw new Error('Room is closed locally')
    this.opened = false
    if (this.base) {
      this.base.removeListener('update', this._onBaseUpdateBound)
      this.base.removeListener('writable', this._onBaseUpdateBound)
      this.base.removeListener('unwritable', this._onBaseUpdateBound)
      this.base.removeListener('error', this._onBaseErrorBound)
    }
    await this._refreshing?.catch(() => {})
    await this.media?.close().catch(() => {})
    this.media = null
    this.mediaEpoch = null
    this._mediaOpening = null
    await this.pairMember?.close().catch(() => {})
    this.pairMember = null
    await this.discovery?.destroy().catch(() => {})
    this.discovery = null
    await this.base?.close().catch(() => {})
    this.base = null
    await this.store.close().catch(() => {})
    this.store = this.rootStore.namespace(`fulltime-room-v1/${this.roomId}`)
    this.bootstrapKey = bootstrapKey
    this.encryptionKey = encryptionKey
    this.localKeyPair = localKeyPair
    this.admissionClaim = admissionClaim
    this._writableHeadFlushed = false
    this._lastDiscoveryRefreshAt = 0
    await this.open({ requireWritable, requireMembership })
  }

  async refresh () {
    if (this.closed || !this.base) return null
    if (this._refreshing) return this._refreshing
    this._refreshing = this._refresh()
    try {
      return await this._refreshing
    } finally {
      this._refreshing = null
    }
  }

  async _refresh () {
    const base = this.base
    if (!base || this.closed) return null
    await base.update()
    if (this.closed || this.base !== base) return null
    if (!(await valueAt(base.view, 'meta/room'))) return null
    await this._flushWritableHead()
    await this._syncPairMember()
    let projection
    try {
      projection = await this.project()
    } catch (error) {
      if (error?.message === 'Room has not been initialized') return null
      throw error
    }
    this.emit('update', projection)
    return projection
  }

  async _flushWritableHead () {
    if (!this.base.writable || this._writableHeadFlushed) return
    this._writableHeadFlushed = true
    try {
      await this.base.append(null)
      await this.base.update()
    } catch (error) {
      this._writableHeadFlushed = false
      throw error
    }
  }

  async project () {
    const base = this.base
    if (!base || this.closed) throw new Error('Room is not open')
    const personal = await this.account.getPersonal(this.roomId)
    const deadline = Date.now() + APPLY_TIMEOUT_MS
    while (Date.now() < deadline) {
      await base.update()
      if (this.closed || this.base !== base) throw new Error('Room is not open')
      if (await valueAt(base.view, 'meta/room')) {
        try {
          return await projectRoom(base.view, {
            identityKeyPair: this.account.identityKeyPair,
            personal,
            presence: this.presence
          })
        } catch (error) {
          if (error?.message !== 'Room has not been initialized') throw error
        }
      }
      await delay(25)
    }
    throw new Error('Room has not been initialized')
  }

  async historyPage ({ limit = 50, cursor = null } = {}) {
    await this.base.update()
    return projectHistoryPage(this.view, {
      identityKeyPair: this.account.identityKeyPair,
      limit,
      cursor
    })
  }

  async threadPage (itemId, { limit = 50, cursor = null } = {}) {
    await this.base.update()
    return projectThreadPage(this.view, itemId, {
      identityKeyPair: this.account.identityKeyPair,
      limit,
      cursor
    })
  }

  async append (type, payload, createdAt = this.operationClock()) {
    if (!this.base) throw new Error('Room is not open')
    this._refreshDiscoveryForActivity()
    const optimistic = !this.base.writable
    if (optimistic && !(await this._hasLocalMembership())) {
      throw new Error('You no longer have write access to this room')
    }
    const operation = createOperation(type, payload, createdAt)
    await this.base.append(operation, optimistic ? { optimistic: true } : undefined)
    const marker = await this._waitForOperation(operation.id)
    if (!marker.applied) throw new Error(marker.reason || 'The room rejected this change')
    await this.refresh()
    return operation
  }

  async updateDisplayName (displayName) {
    await this.base.update()
    const room = await valueAt(this.view, 'meta/room')
    if (!room || room.isClosed) return false
    const userId = userIdFromPublicKey(this.account.identityKeyPair.publicKey)
    const member = await valueAt(this.view, `member/${userId}`)
    if (!member?.active || member.banned || member.displayName === displayName) return false
    await this.append('member.rename', { displayName })
    return true
  }

  async _hasLocalMembership () {
    const userId = userIdFromPublicKey(this.account.identityKeyPair.publicKey)
    const member = await valueAt(this.view, `member/${userId}`)
    return Boolean(
      member?.active &&
      !member.banned &&
      member.writerKey === b4a.toString(this.base.local.key, 'hex')
    )
  }

  async _applyAdmissionClaim () {
    if (await this._hasLocalMembership()) {
      this.admissionClaim = null
      return
    }
    const claim = this.admissionClaim

    // The admitting peer has already appended member.admit, whose reducer adds
    // this candidate's writer to Autobase. Wait until that system change reaches
    // the candidate before publishing the claim. Appending optimistically while
    // the writer is still unauthorized can strand the claim on a local head
    // which Autobase cannot index, most visibly when a member rejoins with a
    // rotated writer key.
    const authorizationDeadline = Date.now() + PAIRING_TIMEOUT_MS
    while (!this.base.writable && Date.now() < authorizationDeadline) {
      await this.base.update()
      if (await this._hasLocalMembership()) {
        this.admissionClaim = null
        return
      }
      await delay(50)
    }
    if (!this.base.writable) {
      const writerKey = b4a.toString(this.base.local.key, 'hex')
      throw new Error(`Timed out waiting for admitted writer authorization (localWriter=${writerKey}, length=${this.base.length}, signedLength=${this.base.signedLength})`)
    }

    const operation = createOperation('member.claim', claim, claim.issuedAt)
    await this.base.append(operation)
    const marker = await this._waitForOperation(operation.id)
    if (!marker.applied) throw new Error(marker.reason || 'The room rejected the signed admission claim')
    this.admissionClaim = null
  }

  async _waitForOperation (id, timeoutMs = APPLY_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await this.base.update()
      const marker = await valueAt(this.view, `operation/${id}`)
      if (marker) return marker
      await delay(20)
    }
    throw new Error('Timed out while applying the room change')
  }

  async initialize ({ fixture, name, displayName }) {
    const writerKey = this.base.local.key
    const identityPublicKey = this.account.identityKeyPair.publicKey
    const signature = signMemberBinding(this.account.identityKeyPair, {
      roomId: this.roomId,
      identityPublicKey,
      writerKey,
      displayName
    })
    await this.append('room.create', {
      roomId: this.roomId,
      type: 'private',
      name,
      fixture,
      creator: {
        userId: userIdFromPublicKey(identityPublicKey),
        displayName,
        identityPublicKey: b4a.toString(identityPublicKey, 'hex'),
        writerKey: b4a.toString(writerKey, 'hex'),
        signature: b4a.toString(signature, 'hex')
      }
    })
    await this._ensureKeyAgreementBinding()
  }

  async createInvite ({ replace = false, expiresAt = null } = {}) {
    const room = await valueAt(this.view, 'meta/room')
    if (!room || room.isClosed) throw new Error('Room is closed')
    if (!replace && room.activeInviteId) {
      const current = await valueAt(this.view, `invite/${room.activeInviteId}`)
      if (current && !current.revokedAt && (!current.expiresAt || current.expiresAt > Date.now())) {
        return (await this.project()).details.invite
      }
    }

    const preview = {
      roomId: room.id,
      roomName: room.name,
      fixture: room.fixture,
      memberCount: room.memberCount,
      createdBy: room.createdBy,
      createdAt: room.createdAt
    }
    const encodedPreview = previewBytes(preview)
    const created = BlindPairing.createInvite(this.base.key, {
      data: encodedPreview,
      ...(expiresAt ? { expires: expiresAt } : {})
    })
    const code = encodeBaseInvite({
      invite: created.invite,
      preview: created.additional.data,
      signature: created.additional.signature
    })
    const createdAt = this.operationClock()
    await this.append('invite.create', {
      id: b4a.toString(created.id, 'hex'),
      code,
      publicKey: b4a.toString(created.publicKey, 'hex'),
      preview: b4a.toString(created.additional.data, 'hex'),
      previewSignature: b4a.toString(created.additional.signature, 'hex'),
      createdAt,
      expiresAt: created.expires || null
    }, createdAt)
    return (await this.project()).details.invite
  }

  async revokeInvite () {
    const room = await valueAt(this.view, 'meta/room')
    if (!room?.activeInviteId) return
    await this.append('invite.revoke', { inviteId: room.activeInviteId })
  }

  async sendMessage (input) {
    if (Object.hasOwn(input, 'attachment')) {
      throw new Error('Attachments must be imported through the encrypted media transfer')
    }
    const id = operationId('item')
    const messageId = operationId('message')
    const quotedItemId = Object.hasOwn(input, 'quotedItemId') ? input.quotedItemId : null
    if (quotedItemId !== null) {
      if (typeof quotedItemId !== 'string' || !/^[a-zA-Z0-9._:-]{3,180}$/.test(quotedItemId)) {
        throw new TypeError('Quoted item ID is invalid')
      }
      const pointer = await valueAt(this.view, `item-id/${quotedItemId}`)
      if (!pointer || pointer.kind !== 'text') throw new Error('Quoted message was not found')
    }
    const operation = await this.append('message.add', {
      id,
      messageId,
      text: input.text,
      ...(quotedItemId ? { quotedItemId } : {})
    })
    return this._itemAfter(operation, id)
  }

  async sendMediaMessage ({ name, source, text = '' }) {
    if (typeof text !== 'string') throw new TypeError('Attachment message text must be a string')
    const room = await valueAt(this.view, 'meta/room')
    if (!room || room.isClosed) throw new Error('Room is closed')
    const media = await this._mediaStoreForEpoch(room.epoch || ROOM_DATA_EPOCH)
    await this._ensureMediaBinding(media)
    const attachment = await media.put({ name, source })
    const id = operationId('item')
    const messageId = operationId('message')
    const operation = await this.append('message.add', {
      id,
      messageId,
      text,
      attachment
    })
    return this._itemAfter(operation, id)
  }

  async readMedia (itemId) {
    if (typeof itemId !== 'string' || !/^[a-zA-Z0-9._:-]{3,180}$/.test(itemId)) {
      throw new TypeError('Media item ID is invalid')
    }
    const pointer = await valueAt(this.view, `item-id/${itemId}`)
    if (!pointer?.key) throw new Error('Media message was not found')
    const item = await valueAt(this.view, pointer.key)
    if (!item?.attachment) throw new Error('Message has no encrypted attachment')
    const attachment = validateMediaDescriptor(item.attachment)
    const room = await valueAt(this.view, 'meta/room')
    if (!room || attachment.epoch !== (room.epoch || ROOM_DATA_EPOCH)) {
      throw new Error('Attachment belongs to an unavailable room key epoch')
    }
    const binding = await valueAt(this.view, `media-core/${attachment.authorId}/${attachment.epoch}`)
    if (!binding || binding.coreKey !== attachment.coreKey) {
      throw new Error('Attachment media core is not authenticated by this room')
    }
    const media = await this._mediaStoreForEpoch(attachment.epoch)
    return { attachment, bytes: await media.get(attachment) }
  }

  async createModerationReport ({ target, reason, note = '' }) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) throw new TypeError('Moderation report target is invalid')
    const room = await valueAt(this.view, 'meta/room')
    if (!room) throw new Error('Room is not initialized')
    if (!await this._hasLocalMembership()) throw new Error('You are no longer an active room member')
    if (target.kind === 'item') {
      if (typeof target.id !== 'string' || !(await valueAt(this.view, `item-id/${target.id}`))) {
        throw new Error('Reported room item was not found')
      }
    } else if (target.kind === 'member') {
      if (typeof target.id !== 'string' || !(await valueAt(this.view, `member/${target.id}`))) {
        throw new Error('Reported room member was not found')
      }
    } else {
      throw new TypeError('Moderation report target is unsupported')
    }
    const recipients = await this._reportRecipients()
    const reportId = operationId('report')
    const envelope = createEncryptedReport({
      roomId: this.roomId,
      reportId,
      reporterId: this.account.userId,
      target,
      reason,
      note,
      createdAt: Date.now(),
      recipients
    })
    await this.append('moderation.report', { reportId, envelope })
    return { reportId }
  }

  async listModerationReports () {
    const member = await valueAt(this.view, `member/${this.account.userId}`)
    if (!member?.active || (member.role !== 'creator' && member.role !== 'moderator')) return []
    const records = (await scan(this.view, 'report/', { limit: 256 }))
      .sort((left, right) => right.createdAt - left.createdAt || left.reportId.localeCompare(right.reportId))
    const reports = []
    for (const record of records) {
      try {
        const report = openEncryptedReport(record.envelope, {
          userId: this.account.userId,
          keyPair: this._keyAgreementKeyPair()
        })
        if (report.roomId !== this.roomId || report.reportId !== record.reportId || report.reporterId !== record.reporterId) continue
        reports.push(report)
      } catch {
        // A newly promoted moderator may not have been a recipient of a prior
        // report. It remains opaque rather than becoming a failed report row.
      }
    }
    return reports
  }

  async createPoll (input) {
    const id = operationId('item')
    const pollId = operationId('poll')
    const options = input.options.map((label) => ({ id: operationId('option'), label }))
    const operation = await this.append('poll.create', { id, pollId, question: input.question, options })
    return this._itemAfter(operation, id)
  }

  async votePoll (pollId, optionId) {
    await this.append('poll.vote', { pollId, optionId })
  }

  async attachMarketReference (input) {
    const operation = await this.append('market.reference', input)
    const projection = await this.project()
    const item = projection.state.items.find((candidate) => candidate.kind === 'poll' && candidate.poll.id === input.pollId)
    if (!item?.poll.marketReference) throw new Error(`Market reference ${operation.id} was not projected`)
    return item
  }

  async reactToItem (itemId, emoji) {
    await this.append('reaction.add', { itemId, emoji })
  }

  async sendReply (itemId, input) {
    const id = operationId('reply')
    const operation = await this.append('reply.add', { id, itemId, text: input.text })
    const projection = await this.project()
    const item = projection.state.items.find((candidate) => candidate.id === itemId)
    const reply = item?.replies.find((candidate) => candidate.id === id)
    if (!reply) throw new Error(`Reply ${operation.id} was applied but not projected`)
    return reply
  }

  async _itemAfter (operation, itemId) {
    const projection = await this.project()
    const item = projection.state.items.find((candidate) => candidate.id === itemId)
    if (!item) throw new Error(`Item ${operation.id} was applied but not projected`)
    return item
  }

  async _mediaStoreForEpoch (epoch) {
    if (this.media && this.mediaEpoch === epoch) return this.media
    if (this._mediaOpening) {
      const media = await this._mediaOpening
      if (this.mediaEpoch === epoch) return media
    }
    const opening = this._openMediaStore(epoch)
    this._mediaOpening = opening
    try {
      return await opening
    } finally {
      if (this._mediaOpening === opening) this._mediaOpening = null
    }
  }

  async _openMediaStore (epoch) {
    if (!this.base?.encryptionKey) throw new Error('Room encryption key is unavailable for media')
    const room = await valueAt(this.view, 'meta/room')
    if (!room || epoch !== (room.epoch || ROOM_DATA_EPOCH)) {
      throw new Error('Attachment key epoch is unavailable on this device')
    }
    await this.media?.close().catch(() => {})
    this.media = null
    this.mediaEpoch = null
    const media = new EncryptedMediaStore({
      store: this.store,
      roomId: this.roomId,
      authorId: this.account.userId,
      epoch,
      epochKey: this.base.encryptionKey
    })
    try {
      await media.ready()
      this.media = media
      this.mediaEpoch = epoch
      return media
    } catch (error) {
      await media.close().catch(() => {})
      throw error
    }
  }

  async _ensureMediaBinding (media) {
    const binding = await valueAt(this.view, `media-core/${this.account.userId}/${media.epoch}`)
    if (binding) {
      if (binding.coreKey !== media.coreKey) {
        throw new Error('This member already has a different authenticated media core for this room epoch')
      }
      return
    }
    await this.append('member.media-core', {
      epoch: media.epoch,
      coreKey: media.coreKey
    })
    const applied = await valueAt(this.view, `media-core/${this.account.userId}/${media.epoch}`)
    if (!applied || applied.coreKey !== media.coreKey) {
      throw new Error('Room did not authenticate this media core')
    }
  }

  _keyAgreementKeyPair () {
    if (this.account.keyAgreementKeyPair) return this.account.keyAgreementKeyPair
    return keyAgreementKeyPairFromIdentity(this.account.identityKeyPair)
  }

  async _ensureKeyAgreementBinding () {
    const room = await valueAt(this.view, 'meta/room')
    if (!room || !await this._hasLocalMembership()) return
    const keyPair = this._keyAgreementKeyPair()
    const writerKey = this.base.local.key
    const publicKey = b4a.toString(keyPair.publicKey, 'hex')
    const existing = await valueAt(this.view, `key-agreement/${this.account.userId}`)
    const writerKeyHex = b4a.toString(writerKey, 'hex')
    if (existing?.publicKey === publicKey && existing.writerKey === writerKeyHex) return
    if (existing && existing.publicKey !== publicKey) {
      throw new Error('The room has a conflicting key-agreement binding for this identity')
    }
    const signature = signMemberKeyAgreement(this.account.identityKeyPair, {
      roomId: this.roomId,
      userId: this.account.userId,
      identityPublicKey: this.account.identityKeyPair.publicKey,
      writerKey,
      keyAgreementPublicKey: keyPair.publicKey
    })
    await this.append('member.key-agreement', {
      publicKey,
      signature: b4a.toString(signature, 'hex')
    })
  }

  async _reportRecipients () {
    const staff = (await scan(this.view, 'member/'))
      .filter((member) => member.active && (member.role === 'creator' || member.role === 'moderator'))
      .sort((left, right) => left.userId.localeCompare(right.userId))
    if (!staff.length || staff.length > MAX_ROOM_MODERATORS) {
      throw new Error('The room moderation roster is unavailable')
    }
    const recipients = []
    for (const member of staff) {
      const binding = await valueAt(this.view, `key-agreement/${member.userId}`)
      if (!binding?.publicKey || typeof binding.publicKey !== 'string' || !/^[a-f0-9]{64}$/.test(binding.publicKey)) {
        throw new Error('A room moderator has not published an encrypted-report key yet')
      }
      recipients.push({ userId: member.userId, publicKey: b4a.from(binding.publicKey, 'hex') })
    }
    return recipients
  }

  async _syncPairMember () {
    const room = await valueAt(this.view, 'meta/room')
    if (!room) return
    const userId = userIdFromPublicKey(this.account.identityKeyPair.publicKey)
    const member = await valueAt(this.view, `member/${userId}`)
    const invite = room.activeInviteId ? await valueAt(this.view, `invite/${room.activeInviteId}`) : null
    const shouldServe = Boolean(
      member?.active &&
      !member.banned &&
      !room.isClosed &&
      invite &&
      !invite.revokedAt &&
      (!invite.expiresAt || invite.expiresAt > Date.now())
    )
    if (!shouldServe) {
      await this.pairMember?.close().catch(() => {})
      this.pairMember = null
      return
    }
    if (this.pairMember) return
    this.pairMember = this.pairing.addMember({
      discoveryKey: this.base.discoveryKey,
      onadd: (request) => {
        return this._handlePairingRequest(request).catch((error) => {
          this.emit('error', error)
          try { request.deny({ status: 1 }) } catch {}
        })
      }
    })
    await this.pairMember.flushed()
  }

  _refreshDiscoveryForActivity () {
    if (this.closed || !this.discovery) return
    const now = Date.now()
    if (now - this._lastDiscoveryRefreshAt < ROOM_DISCOVERY_REFRESH_MS) return
    this._lastDiscoveryRefreshAt = now
    const discovery = this.discovery
    void discovery.refresh({ server: true, client: true, limit: 64 }).catch((error) => {
      if (!this.closed && this.discovery === discovery) this.emit('error', error)
    })
  }

  async _handlePairingRequest (request) {
    const inviteId = b4a.toString(request.inviteId, 'hex')
    const invite = await valueAt(this.view, `invite/${inviteId}`)
    if (!invite) return

    try {
      request.open(b4a.from(invite.publicKey, 'hex'))
    } catch {
      return
    }

    const room = await valueAt(this.view, 'meta/room')
    if (
      !room ||
      room.isClosed ||
      room.activeInviteId !== invite.id ||
      invite.revokedAt ||
      (invite.expiresAt && invite.expiresAt <= Date.now())
    ) {
      request.deny({ status: invite.expiresAt && invite.expiresAt <= Date.now() ? 3 : 1 })
      return
    }

    try {
      decodeCandidateData(request.userData, room.id)
    } catch {
      request.deny({ status: 1 })
      return
    }

    const requestId = b4a.toString(request.id, 'hex')
    let admissionOperation
    try {
      admissionOperation = await this.append('member.admit', {
        requestId,
        inviteId,
        receipt: b4a.toString(request.receipt, 'hex'),
        candidateData: b4a.toString(request.userData, 'hex')
      })
      if (this.base.isIndexer && this.base.writable) {
        // Adding a writer changes Autobase's system view. Do not leave that
        // change only in the indexer's local apply state: a later restart
        // would then know the room but not the admitted writer's core. An
        // explicit null head is an Autobase acknowledgement that causally
        // commits the admission before the signed claim is handed back.
        await this.base.append(null)
        await this.base.update()
      }
    } catch {
      request.deny({ status: 2 })
      return
    }
    const admission = await valueAt(this.view, `admission/${requestId}`)
    if (!admission) {
      request.deny({ status: 2 })
      return
    }
    const claim = createAdmissionClaim(this.account.identityKeyPair, {
      roomId: room.id,
      requestId,
      inviteId,
      receipt: b4a.toString(request.receipt, 'hex'),
      candidateData: b4a.toString(request.userData, 'hex'),
      issuedAt: admissionOperation.createdAt
    })
    const responseData = encodeAdmissionResponse(b4a.from(invite.preview, 'hex'), claim)
    const decodedInvite = BlindPairing.decodeInvite(parseInviteCode(invite.code, { allowExpired: true }).blindInvite)
    const inviteKeyPair = crypto.keyPair(decodedInvite.seed)
    request.confirm({
      key: this.base.key,
      encryptionKey: this.base.encryptionKey,
      additional: {
        data: responseData,
        signature: crypto.sign(responseData, inviteKeyPair.secretKey)
      }
    })
  }

  _onBaseUpdate () {
    if (!this.opened || this.closed) return
    void this.refresh().catch((error) => {
      if (!this.closed) this.emit('error', error)
    })
  }

  _onBaseError (error) {
    this.emit('error', error)
  }

  async rejoin (inviteCode, displayName) {
    const parsed = parseInviteCode(inviteCode)
    if (parsed.preview.roomId !== this.roomId) throw new Error('Invite belongs to a different room')
    const nextWriter = crypto.keyPair()
    const manifest = {
      version: this.store.manifestVersion,
      signers: [{ publicKey: nextWriter.publicKey }]
    }
    const nextWriterKey = Hypercore.key(manifest)
    let auth
    let admissionClaim
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const paired = await pairCandidate({
          pairing: this.pairing,
          parsed,
          displayName,
          identityKeyPair: this.account.identityKeyPair,
          writerKey: nextWriterKey,
          attemptId: operationId('rejoin')
        })
        auth = paired.auth
        admissionClaim = paired.admissionClaim
        break
      } catch (error) {
        if (error?.code !== 'INVITE_USED' || attempt === 3) throw error
        await delay(750)
      }
    }
    if (!auth) throw new Error('The room did not accept the rejoin request')
    if (!b4a.equals(auth.key, this.base.key) || !b4a.equals(auth.encryptionKey, this.base.encryptionKey)) {
      throw new Error('Pairing response does not match the existing room')
    }
    await this.restart({
      bootstrapKey: auth.key,
      encryptionKey: auth.encryptionKey,
      localKeyPair: nextWriter,
      admissionClaim,
      requireMembership: true
    })
    return this.project()
  }

  static async pair ({ store, pairing, inviteCode, displayName, identityKeyPair, resumeInitialized = false }) {
    const parsed = parseInviteCode(inviteCode)
    const probe = Autobase.getLocalCore(store)
    await probe.ready()
    if (probe.length !== 0 && !resumeInitialized) {
      await probe.close()
      throw new Error('This local room namespace is already initialized')
    }
    try {
      // A process can stop after Blind Pairing has initialized and admitted
      // this writer but before AccountStore commits the catalog record. Resume
      // only through the same signed invite and the existing writer key; the
      // host's real admission reducer verifies the identity/writer binding and
      // handles an already-active member idempotently.
      return await pairCandidate({ pairing, parsed, displayName, identityKeyPair, writerKey: probe.key })
    } finally {
      await probe.close().catch(() => {})
    }
  }
}

async function pairCandidate ({ pairing, parsed, displayName, identityKeyPair, writerKey, attemptId = null }) {
  const candidateData = encodeCandidateData({
    roomId: parsed.preview.roomId,
    writerKey,
    displayName,
    identityKeyPair,
    referral: parsed.referral,
    attemptId
  })
  let candidate
  let timer = null
  let request = null
  const cleanup = () => {
    if (timer) clearTimeout(timer)
    timer = null
    request?.removeListener('rejected', onRejected)
  }
  let rejectPairing
  const onRejected = (error) => {
    cleanup()
    rejectPairing(error)
  }
  try {
    const auth = await new Promise((resolve, reject) => {
      rejectPairing = reject
      timer = setTimeout(() => {
        cleanup()
        const stage = candidate?.announced ? 'invite request published' : 'invite request could not be published'
        reject(new Error(`Pairing timed out (${stage}); no active room member answered`))
      }, PAIRING_TIMEOUT_MS)
      try {
        candidate = pairing.addCandidate({
          invite: parsed.blindInvite,
          userData: candidateData,
          onadd: (result) => {
            cleanup()
            resolve(result)
          }
        })
        request = candidate.request
        request.once('rejected', onRejected)
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
    if (!auth.data) throw new Error('Pairing response is missing the signed admission claim')
    const admissionClaim = decodeAdmissionResponse(auth.data, {
      preview: parsed.previewBytes,
      roomId: parsed.preview.roomId,
      inviteId: b4a.toString(parsed.blindInviteId, 'hex'),
      candidateData
    })
    return { auth, parsed, admissionClaim }
  } finally {
    cleanup()
    await candidate?.close().catch(() => {})
  }
}

function delay (milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

module.exports = { APPLY_TIMEOUT_MS, Room }
