'use strict'

const EventEmitter = require('bare-events')
const path = typeof Bare === 'undefined' ? require('path') : require('bare-path')

const b4a = require('b4a')
const BlindPairing = require('blind-pairing')
const Corestore = require('corestore')
const crypto = require('hypercore-crypto')
const Hyperswarm = require('hyperswarm')

const { parseInviteCode } = require('../lib/invite-code.js')
const { normalizeDisplayName } = require('../lib/room-identity.js')
const { MAX_ROOM_MEMBERS } = require('../lib/room-constants.js')
const { AccountStore } = require('./account-store.js')
const { AnswerAttestorClient } = require('./answer-attestor-client.js')
const { FixturePlane } = require('./fixture-plane.js')
const { MediaTransferManager } = require('./media-transfer.js')
const { NotificationStore } = require('./notification-store.js')
const { PresenceNetwork } = require('./presence-network.js')
const { phaseOf, valueAt } = require('./room-view.js')
const { codedError, projectRoomIntelligence, verifyReference } = require('./room-intelligence.js')
const { Room } = require('./room.js')
const { operationId } = require('../lib/room-operations.js')

const ROOM_ID_PREFIX = 'room_'

class RoomManager extends EventEmitter {
  constructor ({
    storagePath,
    displayName,
    fixtureFeedKey,
    deviceSecret,
    bootstrap = undefined,
    fixtureRelay = undefined,
    answerAttestor = null,
    notificationsEnabled = true
  }) {
    super()
    this.storagePath = storagePath
    this.displayName = displayName
    this.fixtureFeedKey = fixtureFeedKey
    if (!b4a.isBuffer(deviceSecret) || deviceSecret.byteLength !== 32) {
      throw new TypeError('Room manager requires a 32-byte device secret')
    }
    this.deviceSecret = b4a.from(deviceSecret)
    this.bootstrap = bootstrap
    this.fixtureRelay = fixtureRelay
    if (answerAttestor !== null && (!answerAttestor || typeof answerAttestor !== 'object' ||
        typeof answerAttestor.servicePublicKey !== 'string' || typeof answerAttestor.receiptFeedKey !== 'string')) {
      throw new TypeError('Room manager answer attestor configuration is invalid')
    }
    this.answerAttestorConfig = answerAttestor
    if (typeof notificationsEnabled !== 'boolean') throw new TypeError('Room manager notificationsEnabled must be a boolean')
    this.notificationsEnabled = notificationsEnabled

    this.store = null
    this.swarm = null
    this.pairing = null
    this.account = null
    this.fixturePlane = null
    this.answerAttestor = null
    this.presence = null
    this.mediaTransfers = null
    this.notifications = null
    this.notificationKnownItems = new Map()
    this.rooms = new Map()
    this.joining = new Map()
    this.revisions = new Map()
    this.closed = false
    this._connectionCloseHandlers = new WeakMap()
  }

  async open () {
    this.store = new Corestore(path.join(this.storagePath, 'pear-room-data'))
    await this.store.ready()
    this.swarm = new Hyperswarm({
      maxPeers: 64,
      ...(this.bootstrap ? { bootstrap: this.bootstrap } : {})
    })
    this.swarm.on('connection', (connection, peerInfo) => this._onConnection(connection, peerInfo))
    this.pairing = new BlindPairing(this.swarm, { poll: 15_000 })
    this.account = new AccountStore(this.store, this.displayName, { deviceSecret: this.deviceSecret })
    this.deviceSecret.fill(0)
    this.deviceSecret = null
    await this.account.ready()
    this.mediaTransfers = new MediaTransferManager({
      getRoom: (roomId) => this.requireRoom(roomId)
    })
    if (this.notificationsEnabled) {
      this.notifications = new NotificationStore(this.store)
      await this.notifications.ready()
    }
    this.presence = new PresenceNetwork({ account: this.account })
    this.fixturePlane = new FixturePlane({
      store: this.store,
      swarm: this.swarm,
      publicKey: this.fixtureFeedKey,
      relay: this.fixtureRelay
    })
    this.fixturePlane.on('update', (card) => {
      this._emit({
        type: 'fixture.updated',
        fixtureId: String(card.fixture.id),
        // Fixture projections deliberately reuse immutable objects internally.
        // IPC is a JSON boundary, so materialize an independent tree before
        // the strict validator rejects those shared references.
        card: JSON.parse(JSON.stringify(card)),
        at: Date.now()
      })
      void this._refreshRoomIntelligence()
    })
    this.fixturePlane.on('error', (error) => this._emitFixtureError(error))
    await this.fixturePlane.open()
    if (this.answerAttestorConfig) {
      this.answerAttestor = new AnswerAttestorClient({
        store: this.store,
        swarm: this.swarm,
        account: this.account,
        servicePublicKey: this.answerAttestorConfig.servicePublicKey,
        receiptFeedKey: this.answerAttestorConfig.receiptFeedKey,
        fixtureFeedKey: this.fixtureFeedKey
      })
      this.answerAttestor.on('receipt', () => void this._refreshRoomIntelligence())
      this.answerAttestor.on('receipt-error', (error) => this._emitRoomError(
        undefined,
        codedError('RECEIPT_FEED_UNAVAILABLE', error instanceof Error ? error.message : 'Pinned answer receipt feed failed'),
        true
      ))
      await this.answerAttestor.open()
    }

    const records = await this.account.listRooms()
    for (const record of records) {
      try {
        await this._openRecord(record)
      } catch (error) {
        this._emitRoomError(record.roomId, error, true)
      }
    }
    this._emit({
      type: 'bridge.ready',
      mode: 'pear-p2p-rooms',
      at: Date.now()
    })
    this._emitTransportStatus()
  }

  async close () {
    if (this.closed) return
    this.closed = true
    const rooms = [...this.rooms.values()]
    this.rooms.clear()
    this.mediaTransfers?.close()
    this.mediaTransfers = null
    this.notificationKnownItems.clear()
    await this.notifications?.close().catch(() => {})
    this.notifications = null
    this.deviceSecret?.fill(0)
    this.deviceSecret = null
    await this.presence?.close().catch(() => {})
    await Promise.allSettled(rooms.map((room) => room.close()))
    await this.answerAttestor?.close().catch(() => {})
    this.answerAttestor = null
    await this.fixturePlane?.close().catch(() => {})
    await this.pairing?.close().catch(() => {})
    await this.swarm?.destroy().catch(() => {})
    await this.account?.close().catch(() => {})
    await this.store?.close().catch(() => {})
    this.removeAllListeners()
  }

  async dispatch (action, payload = null) {
    if (this.closed && action !== 'system.close') throw new Error('Room worker is closing')
    switch (action) {
      case 'system.config':
        return {
          mode: 'pear-p2p-rooms',
          protocolVersion: 2,
          maxRoomMembers: MAX_ROOM_MEMBERS
        }
      case 'system.close':
        await this.close()
        return null
      case 'session.get':
        return this.account.session()
      case 'session.sign-in':
        return this.signIn(requiredString(payload, 'displayName'))
      case 'session.sign-out':
        await this.account.signOut()
        return null
      case 'fixture.list':
        return this.listFixtures(payload)
      case 'fixture.get':
        return this.fixturePlane.get(requiredClosedString(payload, 'fixtureId'))
      case 'fixture.intelligence':
        return this.fixturePlane.intelligence(requiredClosedString(payload, 'fixtureId'))
      case 'record.get':
        this.account.requireSession()
        return this.getRecord()
      case 'room.list':
        return this.listRooms()
      case 'room.get':
        return this.getRoom(requiredString(payload, 'roomId'))
      case 'room.preview-invite':
        return this.previewInvite(requiredString(payload, 'code'))
      case 'room.create':
        return this.createRoom(payload)
      case 'room.join':
        return this.joinRoom(requiredClosedString(payload, 'code'))
      case 'room.details':
        return this.getRoomDetails(requiredString(payload, 'roomId'))
      case 'room.state':
        return (await this.projectRoom(this.requireRoom(requiredString(payload, 'roomId')))).state
      case 'room.answer.submit':
        this.account.requireSession()
        return this.submitAnswer(answerSubmissionPayload(payload))
      case 'room.receipt.get':
        return this.getRoomReceipt(roomReceiptPayload(payload))
      case 'room.replay':
        return this.getRoomReplay(requiredClosedString(payload, 'roomId'))
      case 'room.history.page':
        return this.requireRoom(requiredString(payload, 'roomId')).historyPage(pageOptions(payload, ['roomId']))
      case 'room.thread.page':
        return this.requireRoom(requiredString(payload, 'roomId')).threadPage(
          requiredString(payload, 'itemId'),
          pageOptions(payload, ['roomId', 'itemId'])
        )
      case 'room.message.send':
        this.account.requireSession()
        return this.requireRoom(requiredString(payload, 'roomId')).sendMessage(requiredObject(payload, 'input'))
      case 'room.notification.settings':
        if (!this.notifications) throw new Error('Native notification presentation is unavailable for this room host')
        this.requireRoom(requiredClosedString(payload, 'roomId'))
        return this.notifications.settings(requiredClosedString(payload, 'roomId'))
      case 'room.notification.settings.update':
        if (!this.notifications) throw new Error('Native notification presentation is unavailable for this room host')
        this.requireRoom(requiredString(payload, 'roomId'))
        return this.notifications.updateSettings(requiredString(payload, 'roomId'), notificationSettingsPatch(payload))
      case 'room.report':
        this.account.requireSession()
        return this.requireRoom(requiredString(payload, 'roomId')).createModerationReport(moderationReportPayload(payload))
      case 'room.reports.list':
        return this.requireRoom(requiredClosedString(payload, 'roomId')).listModerationReports()
      case 'room.media.upload.begin':
        this.account.requireSession()
        return this.mediaTransfers.beginUpload(mediaUploadBegin(payload))
      case 'room.media.upload.chunk':
        this.account.requireSession()
        return this.mediaTransfers.appendUpload(mediaUploadChunk(payload))
      case 'room.media.upload.commit':
        this.account.requireSession()
        return this.mediaTransfers.commitUpload(mediaUploadCommit(payload))
      case 'room.media.upload.abort':
        return this.mediaTransfers.abortUpload(mediaUploadAbort(payload))
      case 'room.media.download.begin':
        return this.mediaTransfers.beginDownload(mediaDownloadBegin(payload))
      case 'room.media.download.chunk':
        return this.mediaTransfers.readDownloadChunk(mediaDownloadChunk(payload))
      case 'room.media.download.close':
        return this.mediaTransfers.closeDownload(mediaDownloadClose(payload))
      case 'room.poll.create':
        this.account.requireSession()
        return this.requireRoom(requiredString(payload, 'roomId')).createPoll(requiredObject(payload, 'input'))
      case 'room.poll.vote':
        this.account.requireSession()
        await this.requireRoom(requiredString(payload, 'roomId')).votePoll(
          requiredString(payload, 'pollId'),
          requiredString(payload, 'option')
        )
        return null
      case 'room.market.reference':
        this.account.requireSession()
        return this.requireRoom(requiredString(payload, 'roomId')).attachMarketReference(requiredObject(payload, 'input'))
      case 'room.item.react':
        this.account.requireSession()
        await this.requireRoom(requiredString(payload, 'roomId')).reactToItem(
          requiredString(payload, 'itemId'),
          requiredString(payload, 'emoji')
        )
        return null
      case 'room.reply.send':
        this.account.requireSession()
        return this.requireRoom(requiredString(payload, 'roomId')).sendReply(
          requiredString(payload, 'itemId'),
          requiredObject(payload, 'input')
        )
      case 'room.read.mark':
        await this.markRoomRead(requiredString(payload, 'roomId'), requiredString(payload, 'itemId'))
        return null
      case 'room.invite.create':
        this.account.requireSession()
        return this.requireRoom(requiredString(payload, 'roomId')).createInvite()
      case 'room.invite.regenerate':
        this.account.requireSession()
        return this.requireRoom(requiredString(payload, 'roomId')).createInvite({ replace: true })
      case 'room.invite.revoke':
        this.account.requireSession()
        await this.requireRoom(requiredString(payload, 'roomId')).revokeInvite()
        return null
      case 'room.rename':
        this.account.requireSession()
        await this.requireRoom(requiredString(payload, 'roomId')).append('room.rename', {
          name: requiredString(payload, 'name')
        })
        return null
      case 'room.member.remove':
        this.account.requireSession()
        await this.requireRoom(requiredString(payload, 'roomId')).append('member.remove', {
          userId: requiredString(payload, 'userId')
        })
        return null
      case 'room.member.role':
        this.account.requireSession()
        await this.requireRoom(requiredString(payload, 'roomId')).append('member.role', {
          userId: requiredString(payload, 'userId'),
          role: requiredString(payload, 'role')
        })
        return null
      case 'room.slow-mode':
        this.account.requireSession()
        await this.requireRoom(requiredString(payload, 'roomId')).append('room.slow-mode', {
          seconds: requiredInteger(payload, 'seconds')
        })
        return null
      case 'room.close':
        this.account.requireSession()
        await this.requireRoom(requiredString(payload, 'roomId')).append('room.close', {})
        return null
      case 'room.leave':
        this.account.requireSession()
        await this.requireRoom(requiredString(payload, 'roomId')).append('member.leave', {})
        return null
      case 'room.typing.set':
        this.account.requireSession()
        await this.setTyping(requiredString(payload, 'roomId'), requiredBoolean(payload, 'typing'))
        return null
      case 'notification.pending':
        return this.notifications.pending(notificationPendingOptions(payload))
      case 'notification.lifecycle':
        return this.notifications.transition(...notificationLifecycle(payload))
      default:
        throw new Error(`Unsupported room action: ${action}`)
    }
  }

  async listRooms () {
    const rooms = []
    for (const room of this.rooms.values()) {
      try {
        rooms.push((await room.project()).roomView)
      } catch (error) {
        this._emitRoomError(room.roomId, error, true)
      }
    }
    return rooms
  }

  listFixtures (payload) {
    if (payload === null || payload === undefined) return this.fixturePlane.list({})
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new TypeError('Fixture filter must be an object')
    }
    for (const key of Object.keys(payload)) {
      if (key !== 'phase') throw new TypeError(`Fixture filter field ${key} is unsupported`)
    }
    return this.fixturePlane.list(payload)
  }

  async projectRoom (room) {
    return projectRoomIntelligence({
      roomProjection: await room.project(),
      fixturePlane: this.fixturePlane,
      answerAttestor: this.answerAttestor,
      currentUserId: this.account.userId
    })
  }

  async submitAnswer ({ roomId, callId, optionId }) {
    if (!this.answerAttestor) {
      throw codedError(
        'ATTESTOR_UNAVAILABLE',
        'Live calls are unavailable until pinned answer-attestor and receipt-feed keys are configured'
      )
    }
    const room = this.requireRoom(roomId)
    const roomProjection = await room.project()
    const fixtureId = String(roomProjection.roomView.fixture.id)
    const canonical = this.fixturePlane.getCall(callId)
    if (!canonical || String(canonical.call.fixtureId) !== fixtureId) {
      throw codedError('CALL_FIXTURE_MISMATCH', 'This call does not belong to the room fixture')
    }
    if (!canonical.call.options.some((option) => option.id === optionId)) {
      throw codedError('CALL_OPTION_INVALID', 'Choose one of the canonical call options')
    }
    if (canonical.settlement) {
      throw codedError('CALL_SETTLED', 'This call is already settled by the verified publisher')
    }
    const frontier = this.fixturePlane.frontierFeedTs(fixtureId)
    if (frontier !== null && frontier >= canonical.call.locksAt) {
      throw codedError('CALL_LOCKED', 'This call has reached its signed feed-time lock')
    }
    const existing = Array.isArray(roomProjection.state.answerReferences)
      ? roomProjection.state.answerReferences.find((answer) => answer.userId === this.account.userId && answer.callId === callId)
      : null
    if (existing) throw codedError('ANSWER_ALREADY_RECORDED', 'You already have an immutable accepted answer for this call')

    const token = await this.answerAttestor.submit({
      requestId: operationId('answer-request'),
      answerId: operationId('answer'),
      callId,
      optionId,
      submittedAt: Date.now()
    })
    const claims = token.claims
    const reference = {
      receiptId: claims.tokenId,
      tokenId: claims.tokenId,
      receiptFeedKey: claims.receiptFeedKey,
      receiptIndex: claims.receiptIndex,
      userId: claims.submission.userId,
      answerId: claims.submission.answerId,
      callId: claims.submission.callId,
      optionId: claims.submission.optionId
    }
    // The client already checked the response and its durable receipt block. Do
    // the room/fixture binding check again immediately before the Autobase append.
    const fixtureHead = await this.fixturePlane.head()
    verifyReference({
      reference,
      token,
      pins: this.answerAttestor.pins,
      fixture: roomProjection.roomView.fixture,
      fixturePlane: this.fixturePlane,
      fixtureHead
    })
    await room.append('answer.reference', reference)
    const projected = await this.projectRoom(room)
    const receipt = projected.state.receipts.find((candidate) => candidate.id === reference.receiptId)
    if (!receipt) {
      throw codedError('RECEIPT_PROJECTION_FAILED', 'The accepted answer could not be verified from the replicated receipt feed')
    }
    return receipt
  }

  async getRoomReceipt ({ roomId, receiptId }) {
    const room = this.requireRoom(roomId)
    const raw = await room.project()
    const reference = Array.isArray(raw.state.answerReferences)
      ? raw.state.answerReferences.find((candidate) => candidate.receiptId === receiptId)
      : null
    if (!reference) throw codedError('RECEIPT_NOT_FOUND', 'This receipt is not referenced by the selected room')
    const projected = await this.projectRoom(room)
    const receipt = projected.state.receipts.find((candidate) => candidate.id === receiptId)
    if (!receipt) {
      const failure = projected.state.receiptVerificationErrors?.find((candidate) => candidate.receiptId === receiptId)
      throw codedError(
        failure?.code || 'RECEIPT_UNAVAILABLE',
        receiptVerificationMessage(failure?.code)
      )
    }
    return receipt
  }

  async signIn (displayName) {
    const session = await this.account.signIn(displayName)
    const results = await Promise.allSettled(
      [...this.rooms.values()].map((room) => room.updateDisplayName(session.displayName))
    )
    const failed = results.find((result) => result.status === 'rejected')
    if (failed) throw new Error('The display name was saved, but could not be replicated to every active room', { cause: failed.reason })
    return session
  }

  async getRecord () {
    const session = this.account.requireSession()
    const entries = []
    const seen = new Set()
    for (const room of this.rooms.values()) {
      const projection = await this.projectRoom(room)
      for (const receipt of projection.state.receipts) {
        if (receipt.userId !== session.userId || seen.has(receipt.id)) continue
        seen.add(receipt.id)
        const fixture = projection.state.fixture.fixture
        entries.push({
          receiptId: receipt.id,
          roomId: projection.roomView.room.id,
          fixtureId: fixture.id,
          fixtureLabel: `${fixture.home.name} v ${fixture.away.name}`,
          homeCode: fixture.home.country || null,
          awayCode: fixture.away.country || null,
          prompt: receipt.callPrompt,
          chosenOption: receipt.optionId,
          chosenLabel: receipt.optionLabel,
          acceptedAt: receipt.acceptedAt,
          outcome: receipt.outcome,
          points: receipt.points,
          receiptState: receipt.state,
          scored: Boolean(receipt.scored)
        })
      }
    }
    entries.sort((left, right) => right.acceptedAt - left.acceptedAt || left.receiptId.localeCompare(right.receiptId))
    const scored = entries.filter((entry) => entry.scored)
    const correct = scored.filter((entry) => entry.outcome === 'correct').length
    return {
      userId: session.userId,
      displayName: session.displayName,
      fanIq: scored.reduce((total, entry) => total + entry.points, 0),
      accuracy: scored.length ? correct / scored.length : 0,
      matchesPlayed: new Set(entries.map((entry) => String(entry.fixtureId))).size,
      totalCalls: entries.length,
      entries
    }
  }

  async getRoomReplay (roomId) {
    const projection = await this.projectRoom(this.requireRoom(roomId))
    return {
      room: projection.roomView.room,
      fixture: projection.state.fixture.fixture,
      fixtureCard: projection.state.fixture,
      timeline: projection.state.timeline,
      oddsHistory: projection.state.oddsHistory,
      marketSays: projection.state.marketSays,
      pressure: projection.state.pressure,
      calls: projection.state.calls,
      receipts: projection.state.receipts,
      frontierFeedTs: projection.state.frontierFeedTs
    }
  }

  async getRoom (roomId) {
    const room = this.rooms.get(roomId)
    return room ? (await room.project()).roomView : null
  }

  previewInvite (code) {
    const parsed = parseInviteCode(code)
    const { createdAt, createdBy, fixture, memberCount, roomId, roomName } = parsed.preview
    this.fixturePlane.assertVerifiedSnapshot(fixture)
    return {
      room: {
        id: roomId,
        fixtureId: fixture.id,
        type: 'private',
        name: roomName,
        createdBy,
        createdAt
      },
      fixture,
      phase: phaseOf(fixture.status),
      members: memberCount,
      inviteCode: code
    }
  }

  async createRoom (payload) {
    const input = payload
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Room input must be an object')
    requireOnlyKeys(input, ['fixtureId', 'roomName', 'displayName'], 'Room input')
    const displayName = normalizeDisplayName(requiredString(input, 'displayName'))
    const fixture = this.fixturePlane.requireFixture(requiredString(input, 'fixtureId'))
    await this.account.signIn(displayName)
    const roomId = `${ROOM_ID_PREFIX}${b4a.toString(crypto.randomBytes(16), 'hex')}`
    const room = this._makeRoom({ roomId })
    this.rooms.set(roomId, room)
    try {
      await room.open({ requireWritable: true })
      await room.initialize({ fixture, name: requiredString(input, 'roomName'), displayName })
      await this.presence.addRoom(room)
      await this.account.putRoom({
        roomId,
        fixtureId: String(fixture.id),
        bootstrapKey: b4a.toString(room.base.key, 'hex'),
        discoveryKey: b4a.toString(room.base.discoveryKey, 'hex'),
        joinedAt: Date.now()
      })
      await room.createInvite()
      return (await room.project()).details
    } catch (error) {
      this.rooms.delete(roomId)
      await this.presence.removeRoom(roomId).catch(() => {})
      await room.close()
      throw error
    }
  }

  async joinRoom (code) {
    const session = this.account.requireSession()
    const parsed = parseInviteCode(code)
    await this.fixturePlane.assertVerifiedSnapshotAfterSync(parsed.preview.fixture)
    const roomId = parsed.preview.roomId
    const existing = this.rooms.get(roomId)
    if (existing) {
      const membership = await valueAt(existing.view, `member/${this.account.userId}`)
      if (!membership?.active) {
        await existing.rejoin(code, session.displayName)
        await this.presence.announce(roomId, 'online')
      }
      return (await existing.project()).roomView
    }
    if (this.joining.has(roomId)) return (await this.joining.get(roomId)).roomView

    const joining = this._joinRoom({ code, roomId, session })
    this.joining.set(roomId, joining)
    try {
      const projection = await joining
      return projection.roomView
    } finally {
      this.joining.delete(roomId)
    }
  }

  async _joinRoom ({ code, roomId, session }) {
    const pairingStore = this.store.namespace(`fulltime-room-v1/${roomId}`)
    let paired
    try {
      paired = await Room.pair({
        store: pairingStore,
        pairing: this.pairing,
        inviteCode: code,
        displayName: session.displayName,
        identityKeyPair: this.account.identityKeyPair
      })
    } finally {
      await pairingStore.close().catch(() => {})
    }

    const room = this._makeRoom({
      roomId,
      bootstrapKey: paired.auth.key,
      encryptionKey: paired.auth.encryptionKey,
      admissionClaim: paired.admissionClaim
    })
    this.rooms.set(roomId, room)
    try {
      await room.open({ requireMembership: true })
      await this.presence.addRoom(room)
      await this.account.putRoom({
        roomId,
        fixtureId: String(paired.parsed.preview.fixture.id),
        bootstrapKey: b4a.toString(room.base.key, 'hex'),
        discoveryKey: b4a.toString(room.base.discoveryKey, 'hex'),
        joinedAt: Date.now()
      })
      return room.project()
    } catch (error) {
      this.rooms.delete(roomId)
      await this.presence.removeRoom(roomId).catch(() => {})
      await room.close()
      throw error
    }
  }

  async getRoomDetails (roomId) {
    const room = this.rooms.get(roomId)
    return room ? (await room.project()).details : null
  }

  requireRoom (roomId) {
    const room = this.rooms.get(roomId)
    if (!room) throw new Error('Room is not available on this device')
    return room
  }

  async markRoomRead (roomId, itemId) {
    const room = this.requireRoom(roomId)
    const projection = await room.project()
    const targetIndex = projection.state.items.findIndex((item) => item.id === itemId)
    if (targetIndex < 0) throw new Error('Read marker item was not found')
    const personal = await this.account.getPersonal(roomId)
    if (personal.lastReadItemId) {
      const currentIndex = projection.state.items.findIndex((item) => item.id === personal.lastReadItemId)
      if (currentIndex >= targetIndex) return
    }
    await this.account.updatePersonal(roomId, { lastReadItemId: itemId })
    await room.refresh()
  }

  async setTyping (roomId, typing) {
    this.requireRoom(roomId)
    await this.presence.setTyping(roomId, typing)
  }

  async _openRecord (record) {
    if (!record?.roomId || this.rooms.has(record.roomId)) return this.rooms.get(record.roomId)
    const room = this._makeRoom({
      roomId: record.roomId,
      ...(record.bootstrapKey ? { bootstrapKey: b4a.from(record.bootstrapKey, 'hex') } : {})
    })
    this.rooms.set(record.roomId, room)
    try {
      await room.open({ waitForUpdate: false })
      const projection = await room.project()
      await this.fixturePlane.assertVerifiedSnapshotAfterSync(projection.roomView.fixture)
      await this.presence.addRoom(room)
      return room
    } catch (error) {
      this.rooms.delete(record.roomId)
      await this.presence.removeRoom(record.roomId).catch(() => {})
      await room.close()
      throw error
    }
  }

  _makeRoom (options) {
    const room = new Room({
      rootStore: this.store,
      swarm: this.swarm,
      pairing: this.pairing,
      account: this.account,
      ...options
    })
    room.on('update', (projection) => {
      void this._handleRoomUpdate(room, projection).catch((error) => this._emitRoomError(room.roomId, error, true))
    })
    room.on('error', (error) => this._emitRoomError(room.roomId, error, true))
    return room
  }

  async _handleRoomUpdate (room, projection) {
      void this.presence?.roomUpdated(room).catch((error) => this._emitRoomError(room.roomId, error, true))
      void this._queueRemoteMessageNotifications(room, projection).catch((error) => this._emitRoomError(room.roomId, error, true))
      const enriched = await projectRoomIntelligence({
        roomProjection: projection,
        fixturePlane: this.fixturePlane,
        answerAttestor: this.answerAttestor,
        currentUserId: this.account.userId
      })
      const revision = (this.revisions.get(room.roomId) || 0) + 1
      this.revisions.set(room.roomId, revision)
      const at = Date.now()
      this._emit({
        type: 'room.state',
        roomId: room.roomId,
        revision,
        state: enriched.state,
        at
      })
      this._emit({
        type: 'room.details',
        roomId: room.roomId,
        revision,
        details: enriched.details,
        at
      })
  }

  async _refreshRoomIntelligence () {
    if (this.closed) return
    await Promise.allSettled([...this.rooms.values()].map((room) => room.refresh()))
  }

  _onConnection (connection, peerInfo) {
    this.store.replicate(connection)
    this.presence?.addConnection(connection, peerInfo)
    this.answerAttestor?.addConnection(connection, peerInfo)
    const onClose = () => {
      this._connectionCloseHandlers.delete(connection)
      this._emitTransportStatus()
    }
    this._connectionCloseHandlers.set(connection, onClose)
    connection.once('close', onClose)
    this._emitTransportStatus()
  }

  _emitTransportStatus () {
    this._emit({
      type: 'transport.status',
      status: this.swarm && this.swarm.connections.size > 0 ? 'online' : 'discovering',
      peerCount: this.swarm ? this.swarm.connections.size : 0,
      at: Date.now()
    })
  }

  _emitRoomError (roomId, error, recoverable) {
    this._emit({
      type: 'room.error',
      roomId,
      code: typeof error?.code === 'string' ? error.code : 'ROOM_ERROR',
      message: error instanceof Error ? error.message : 'Room failed',
      recoverable,
      at: Date.now()
    })
  }

  _emitFixtureError (error) {
    this._emit({
      type: 'room.error',
      action: 'fixture.list',
      code: typeof error?.code === 'string' ? error.code : 'FIXTURE_PLANE_ERROR',
      message: error instanceof Error ? error.message : 'Verified fixture feed failed',
      recoverable: true,
      at: Date.now()
    })
  }

  _emit (event) {
    this.emit('event', { version: 2, ...event })
  }

  async _queueRemoteMessageNotifications (room, projection) {
    if (!this.notifications || !projection?.state?.items) return
    const items = projection.state.items
    let known = this.notificationKnownItems.get(room.roomId)
    if (!known) {
      known = new Set(items.map((item) => item.id))
      this.notificationKnownItems.set(room.roomId, known)
      return
    }
    const unseen = []
    for (const item of items) {
      if (known.has(item.id)) continue
      known.add(item.id)
      unseen.push(item)
    }
    while (known.size > 2048) known.delete(known.values().next().value)
    for (const item of unseen) {
      if (item.kind !== 'text' || !item.author || item.author.userId === this.account.userId) continue
      const body = notificationBody(item)
      const intent = await this.notifications.enqueue({
        id: notificationId(room.roomId, item.id),
        sourceId: item.id,
        roomId: room.roomId,
        category: 'message',
        title: notificationText(room.name, 80, 'FullTime room'),
        body,
        target: { roomId: room.roomId, itemId: item.id },
        createdAt: Date.now()
      })
      if (intent) {
        this._emit({ type: 'notification.queued', intent, at: Date.now() })
      }
    }
  }
}

function requiredObject (value, key) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Payload must be an object')
  const result = value[key]
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new TypeError(`${key} must be an object`)
  return result
}

function requiredString (value, key) {
  if (!value || typeof value !== 'object' || typeof value[key] !== 'string' || !value[key].trim()) {
    throw new TypeError(`${key} must be a non-empty string`)
  }
  return value[key]
}

function requiredClosedString (value, key) {
  const result = requiredString(value, key)
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== key) throw new TypeError(`Payload supports only ${key}`)
  return result
}

function requireOnlyKeys (value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${label} field ${key} is unsupported`)
  }
}

function requiredInteger (value, key) {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value[key])) throw new TypeError(`${key} must be an integer`)
  return value[key]
}

function requiredBoolean (value, key) {
  if (!value || typeof value !== 'object' || typeof value[key] !== 'boolean') throw new TypeError(`${key} must be a boolean`)
  return value[key]
}

function pageOptions (value, requiredKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Page payload must be an object')
  requireOnlyKeys(value, [...requiredKeys, 'limit', 'cursor'], 'Page payload')
  const limit = Object.hasOwn(value, 'limit') ? requiredInteger(value, 'limit') : 50
  if (limit < 1 || limit > 100) throw new TypeError('limit must be an integer from 1 to 100')
  let cursor = null
  if (Object.hasOwn(value, 'cursor') && value.cursor !== null) {
    if (typeof value.cursor !== 'string' || !value.cursor || value.cursor.length > 1024) {
      throw new TypeError('cursor must be a bounded non-empty string or null')
    }
    cursor = value.cursor
  }
  return { limit, cursor }
}

function answerSubmissionPayload (value) {
  requireOnlyKeys(value, ['roomId', 'callId', 'optionId'], 'Answer submission')
  return {
    roomId: requiredString(value, 'roomId'),
    callId: requiredString(value, 'callId'),
    optionId: requiredString(value, 'optionId')
  }
}

function roomReceiptPayload (value) {
  requireOnlyKeys(value, ['roomId', 'receiptId'], 'Room receipt lookup')
  return {
    roomId: requiredString(value, 'roomId'),
    receiptId: requiredString(value, 'receiptId')
  }
}

function receiptVerificationMessage (code) {
  switch (code) {
    case 'ATTESTOR_UNAVAILABLE': return 'This host has no configured pinned answer-attestor and receipt-feed keys'
    case 'RECEIPT_NOT_REPLICATED': return 'This receipt has not replicated from the pinned answer receipt feed yet'
    case 'RECEIPT_FEED_UNAVAILABLE': return 'The pinned answer receipt feed is unavailable'
    case 'RECEIPT_INVALID': return 'The pinned answer receipt did not verify'
    case 'RECEIPT_REFERENCE_MISMATCH': return 'The room answer reference does not match its pinned receipt'
    case 'RECEIPT_FIXTURE_FEED_MISMATCH': return 'The receipt is bound to a different fixture publisher'
    case 'RECEIPT_FIXTURE_HEAD_MISMATCH': return 'The local signed fixture head cannot verify this receipt yet'
    case 'RECEIPT_CALL_UNAVAILABLE': return 'The receipt references a call unavailable from this room fixture'
    case 'RECEIPT_CALL_MISMATCH': return 'The receipt does not bind the canonical signed call'
    default: return 'This room receipt is waiting for pinned receipt-feed verification'
  }
}

function mediaUploadBegin (value) {
  requireOnlyKeys(value, ['roomId', 'name', 'sizeBytes'], 'Media upload')
  return {
    roomId: requiredString(value, 'roomId'),
    name: requiredString(value, 'name'),
    sizeBytes: requiredInteger(value, 'sizeBytes')
  }
}

function mediaUploadChunk (value) {
  requireOnlyKeys(value, ['roomId', 'uploadId', 'index', 'data'], 'Media upload chunk')
  return {
    roomId: requiredString(value, 'roomId'),
    uploadId: requiredString(value, 'uploadId'),
    index: requiredInteger(value, 'index'),
    data: requiredString(value, 'data')
  }
}

function mediaUploadCommit (value) {
  requireOnlyKeys(value, ['roomId', 'uploadId', 'text'], 'Media upload commit')
  if (!value || typeof value !== 'object' || typeof value.text !== 'string') {
    throw new TypeError('Attachment message text must be a string')
  }
  return {
    roomId: requiredString(value, 'roomId'),
    uploadId: requiredString(value, 'uploadId'),
    text: value.text
  }
}

function mediaUploadAbort (value) {
  requireOnlyKeys(value, ['roomId', 'uploadId'], 'Media upload abort')
  return { roomId: requiredString(value, 'roomId'), uploadId: requiredString(value, 'uploadId') }
}

function mediaDownloadBegin (value) {
  requireOnlyKeys(value, ['roomId', 'itemId'], 'Media download')
  return { roomId: requiredString(value, 'roomId'), itemId: requiredString(value, 'itemId') }
}

function mediaDownloadChunk (value) {
  requireOnlyKeys(value, ['roomId', 'downloadId', 'index'], 'Media download chunk')
  return {
    roomId: requiredString(value, 'roomId'),
    downloadId: requiredString(value, 'downloadId'),
    index: requiredInteger(value, 'index')
  }
}

function mediaDownloadClose (value) {
  requireOnlyKeys(value, ['roomId', 'downloadId'], 'Media download close')
  return { roomId: requiredString(value, 'roomId'), downloadId: requiredString(value, 'downloadId') }
}

function notificationSettingsPatch (value) {
  if (!value || typeof value !== 'object' || !value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings)) {
    throw new TypeError('Notification settings payload is invalid')
  }
  requireOnlyKeys(value, ['roomId', 'settings'], 'Notification settings payload')
  const settings = value.settings
  for (const key of Object.keys(settings)) {
    if (!['calls', 'messages', 'moderation'].includes(key) || typeof settings[key] !== 'boolean') {
      throw new TypeError(`Notification setting ${key} is unsupported`)
    }
  }
  if (Object.keys(settings).length < 1) throw new TypeError('Notification settings patch is empty')
  return settings
}

function moderationReportPayload (value) {
  requireOnlyKeys(value, ['roomId', 'target', 'reason', 'note'], 'Moderation report payload')
  if (!value || typeof value !== 'object' || !value.target || typeof value.target !== 'object' || Array.isArray(value.target)) {
    throw new TypeError('Moderation report target is invalid')
  }
  requireOnlyKeys(value.target, ['kind', 'id'], 'Moderation report target')
  if (typeof value.target.kind !== 'string' || typeof value.target.id !== 'string' ||
      typeof value.reason !== 'string' || typeof value.note !== 'string') {
    throw new TypeError('Moderation report payload is invalid')
  }
  return {
    target: { kind: value.target.kind, id: value.target.id },
    reason: value.reason,
    note: value.note
  }
}

function notificationPendingOptions (value) {
  if (value === null || value === undefined) return { limit: 32 }
  requireOnlyKeys(value, ['limit'], 'Notification pending payload')
  const limit = requiredInteger(value, 'limit')
  if (limit < 1 || limit > 64) throw new TypeError('Notification pending limit must be 1-64')
  return { limit }
}

function notificationLifecycle (value) {
  requireOnlyKeys(value, ['id', 'state', 'at', 'failure'], 'Notification lifecycle payload')
  const id = requiredString(value, 'id')
  const state = requiredString(value, 'state')
  const at = requiredInteger(value, 'at')
  const failure = value.failure === null ? null : requiredString(value, 'failure')
  return [id, state, at, failure]
}

function notificationId (roomId, itemId) {
  const digest = crypto.hash(b4a.from(`fulltime/notification/message/v1/${roomId}/${itemId}`))
  return `notify_${b4a.toString(digest.subarray(0, 16), 'hex')}`
}

function notificationBody (item) {
  const name = notificationText(item.author.displayName, 64, 'A room member')
  const content = item.text
    ? notificationText(item.text, 160, 'sent a message')
    : item.attachment ? 'sent an encrypted attachment' : 'sent a message'
  return notificationText(`${name}: ${content}`, 240, 'New room message')
}

function notificationText (value, maximum, fallback) {
  if (typeof value !== 'string') return fallback
  const text = value.normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum)
    .trim()
  return text || fallback
}

module.exports = { ROOM_ID_PREFIX, RoomManager }
