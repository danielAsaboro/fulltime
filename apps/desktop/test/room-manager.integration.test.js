'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const BlindPairing = require('blind-pairing')
const b4a = require('b4a')
const createTestnet = require('hyperdht/testnet')
const crypto = require('hypercore-crypto')

const { encodeBaseInvite, previewBytes } = require('../lib/invite-code.js')
const { RoomManager } = require('../workers/room-manager.js')
const { valueAt } = require('../workers/room-view.js')
const { SignedFixturePublisher } = require('./signed-fixture-publisher.js')

const enabled = process.env.FULLTIME_RUN_PEAR_INTEGRATION === '1'

test('three encrypted room peers pair, replicate chat, replies, reactions, polls, and a market reference', {
  skip: enabled ? false : 'set FULLTIME_RUN_PEAR_INTEGRATION=1 to bind a local DHT testnet',
  timeout: 150_000
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fulltime-room-integration-'))
  const creatorDeviceSecret = crypto.randomBytes(32)
  const memberDeviceSecret = crypto.randomBytes(32)
  const thirdDeviceSecret = crypto.randomBytes(32)
  const offlineDeviceSecret = crypto.randomBytes(32)
  const lateDeviceSecret = crypto.randomBytes(32)
  const interruptedDeviceSecret = crypto.randomBytes(32)
  const testnet = await createTestnet(3, { host: '127.0.0.1' })
  const fixture = {
    id: 'fixture-1',
    competition: 'Test Cup',
    home: { id: 'home', name: 'Home' },
    away: { id: 'away', name: 'Away' },
    kickoff: Date.now() + 60_000,
    status: 'scheduled'
  }
  const publisher = new SignedFixturePublisher({
    storagePath: path.join(root, 'fixture-publisher'),
    bootstrap: testnet.bootstrap
  })
  await publisher.open()
  await publisher.publishFixture(fixture)
  const creator = new RoomManager({
    storagePath: path.join(root, 'creator'),
    displayName: 'Creator',
    fixtureFeedKey: publisher.key,
    deviceSecret: creatorDeviceSecret,
    bootstrap: testnet.bootstrap
  })
  const member = new RoomManager({
    storagePath: path.join(root, 'member'),
    displayName: 'Member',
    fixtureFeedKey: publisher.key,
    deviceSecret: memberDeviceSecret,
    bootstrap: testnet.bootstrap
  })
  const third = new RoomManager({
    storagePath: path.join(root, 'third'),
    displayName: 'Third',
    fixtureFeedKey: publisher.key,
    deviceSecret: thirdDeviceSecret,
    bootstrap: testnet.bootstrap
  })
  let restartedCreator = null
  let offlineMember = null
  let lateMember = null
  let interruptedMember = null
  creator.on('event', (event) => {
    if (event.type === 'room.error') console.error('[creator room error]', event)
  })
  member.on('event', (event) => {
    if (event.type === 'room.error') console.error('[member room error]', event)
  })
  third.on('event', (event) => {
    if (event.type === 'room.error') console.error('[third room error]', event)
  })

  try {
    await Promise.all([creator.open(), member.open(), third.open()])
    await waitFor(async () => Boolean(await creator.dispatch('fixture.get', { fixtureId: fixture.id })), 'verified fixture replication')
    const forgedPreview = previewBytes({
      roomId: 'room_forged_fixture',
      roomName: 'Forged room',
      fixture: { ...fixture, competition: 'Forged Cup' },
      memberCount: 1,
      createdBy: 'peer_forged_creator',
      createdAt: Date.now()
    })
    const forgedInvite = BlindPairing.createInvite(crypto.randomBytes(32), { data: forgedPreview })
    const forgedCode = encodeBaseInvite({
      invite: forgedInvite.invite,
      preview: forgedInvite.additional.data,
      signature: forgedInvite.additional.signature
    })
    await assert.rejects(creator.dispatch('room.preview-invite', { code: forgedCode }), /exact snapshot/)
    await assert.rejects(member.dispatch('room.join', { code: forgedCode }), /exact snapshot/)
    await assert.rejects(creator.dispatch('room.create', {
      fixtureId: fixture.id,
      roomName: 'Renderer supplied fixture',
      displayName: 'Creator',
      fixture
    }), /field fixture is unsupported/)
    const details = await creator.dispatch('room.create', {
      fixtureId: fixture.id,
      roomName: 'Pear room',
      displayName: 'Creator'
    })
    assert.equal(details.members.length, 1)
    assert.equal(details.invite.status, 'active')
    const creatorRoom = creator.requireRoom(details.room.id)
    assert.ok(creatorRoom.pairMember, 'creator should announce blind-pairing admission')
    assert.equal(creatorRoom.pairMember.discoveryKey.equals(creatorRoom.base.discoveryKey), true)

    const feedTs = Date.now()
    const update = {
      fixtureId: fixture.id,
      feedTs,
      messageId: `${fixture.id}:1`,
      seq: 1,
      statusCode: 2,
      status: 'first-half',
      minute: 1,
      score: { home: 1, away: 0 },
      hasScore: true
    }
    await publisher.publishScore({
      update,
      state: {
        fixtureId: fixture.id,
        status: update.status,
        minute: update.minute,
        score: update.score,
        lastFeedTs: update.feedTs,
        lastMessageId: update.messageId,
        gaps: []
      }
    })
    await waitFor(async () => (await member.dispatch('fixture.get', { fixtureId: fixture.id }))?.score?.home === 1, 'advanced fixture snapshot')

    // The invite contains the exact signed pre-match snapshot. It remains valid
    // after the publisher advances because historical verified snapshots are kept.
    const joined = await member.dispatch('room.join', { code: details.invite.code })
    assert.equal(joined.room.id, details.room.id)
    const thirdJoined = await third.dispatch('room.join', { code: details.invite.code })
    assert.equal(thirdJoined.room.id, details.room.id)
    await waitFor(async () => (await creator.dispatch('room.state', { roomId: details.room.id })).members.length === 3, 'three concurrent room members')

    const memberSession = await member.dispatch('session.get', null)
    await member.dispatch('room.typing.set', { roomId: details.room.id, typing: true })
    await waitFor(async () => {
      const state = await creator.dispatch('room.state', { roomId: details.room.id })
      return state.typingUsers.some((user) => user.userId === memberSession.userId && user.isOnline)
    }, 'signed Protomux typing presence')
    await member.dispatch('room.typing.set', { roomId: details.room.id, typing: false })

    const sent = await member.dispatch('room.message.send', {
      roomId: details.room.id,
      input: { text: 'hello over Autobase' }
    })
    assert.equal(sent.kind, 'text')

    await waitFor(async () => {
      const states = await Promise.all([creator, third].map((manager) => manager.dispatch('room.state', { roomId: details.room.id })))
      return states.every((state) => state.items.some((item) => item.kind === 'text' && item.text === 'hello over Autobase'))
    }, 'message replication to creator and third peer')
    await third.dispatch('room.reply.send', {
      roomId: details.room.id,
      itemId: sent.id,
      input: { text: 'reply from the third peer' }
    })
    await third.dispatch('room.item.react', { roomId: details.room.id, itemId: sent.id, emoji: '🔥' })
    await waitFor(async () => {
      const [thread, state] = await Promise.all([
        creator.dispatch('room.thread.page', { roomId: details.room.id, itemId: sent.id, limit: 10 }),
        creator.dispatch('room.state', { roomId: details.room.id })
      ])
      const message = state.items.find((item) => item.id === sent.id)
      return thread.items.some((reply) => reply.text === 'reply from the third peer') &&
        message?.reactions?.some((reaction) => reaction.emoji === '🔥' && reaction.count === 1)
    }, 'third-peer reply and reaction replication')

    const attachmentBytes = b4a.from('Encrypted room attachment replicated through a pinned Hypercore.\n'.repeat(1_200))
    const upload = await member.dispatch('room.media.upload.begin', {
      roomId: details.room.id,
      name: 'match-note.txt',
      sizeBytes: attachmentBytes.byteLength
    })
    await member.dispatch('room.media.upload.chunk', {
      roomId: details.room.id,
      uploadId: upload.uploadId,
      index: 0,
      data: b4a.toString(attachmentBytes, 'base64url')
    })
    const attached = await member.dispatch('room.media.upload.commit', {
      roomId: details.room.id,
      uploadId: upload.uploadId,
      text: 'Verified attachment'
    })
    assert.equal(attached.attachment.mimeType, 'text/plain')
    await waitFor(async () => {
      const state = await creator.dispatch('room.state', { roomId: details.room.id })
      return state.items.some((item) => item.id === attached.id && item.attachment?.coreKey === attached.attachment.coreKey)
    }, 'authenticated media descriptor replication')
    const download = await creator.dispatch('room.media.download.begin', {
      roomId: details.room.id,
      itemId: attached.id
    })
    const downloaded = []
    for (let index = 0; index < download.chunks; index++) {
      const chunk = await creator.dispatch('room.media.download.chunk', {
        roomId: details.room.id,
        downloadId: download.downloadId,
        index
      })
      downloaded.push(b4a.from(chunk.data, 'base64url'))
      assert.equal(chunk.hasMore, index + 1 < download.chunks)
    }
    assert.deepEqual(b4a.concat(downloaded), attachmentBytes)

    const poll = await creator.dispatch('room.poll.create', {
      roomId: details.room.id,
      input: { question: 'Total goals?', options: ['0', '1', '2', '3', '4+'] }
    })
    const reference = {
      pollId: poll.poll.id,
      network: 'localnet',
      program: '8VNZ5VseAcFaYhAZxetgE5N8eiD17ZZNchGhoatYUUXw',
      mint: 'ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh',
      market: '11111111111111111111111111111111',
      fixtureId: 'fixture-1',
      rulebookHash: 'a'.repeat(64),
      creationSignature: '2'.repeat(88)
    }
    await assert.rejects(member.dispatch('room.market.reference', { roomId: details.room.id, input: reference }), /projected|rejected/i)
    await assert.rejects(third.dispatch('room.market.reference', { roomId: details.room.id, input: reference }), /projected|rejected/i)
    await creator.dispatch('room.market.reference', { roomId: details.room.id, input: reference })
    await waitFor(async () => {
      const states = await Promise.all([member, third].map((manager) => manager.dispatch('room.state', { roomId: details.room.id })))
      return states.every((state) => state.items.some((item) => item.kind === 'poll' && item.poll.marketReference?.market === reference.market))
    }, 'authenticated market reference replication to both remote peers')
    await member.dispatch('room.poll.vote', {
      roomId: details.room.id,
      pollId: poll.poll.id,
      option: poll.poll.options[0].id
    })
    await third.dispatch('room.poll.vote', {
      roomId: details.room.id,
      pollId: poll.poll.id,
      option: poll.poll.options[3].id
    })
    await waitFor(async () => {
      const state = await creator.dispatch('room.state', { roomId: details.room.id })
      const projected = state.items.find((item) => item.kind === 'poll' && item.poll.id === poll.poll.id)
      return projected?.poll.options[0].votes === 1 && projected.poll.options[3].votes === 1
    }, 'opposing votes from two remote peers')
    await assert.rejects(
      member.dispatch('room.poll.vote', {
        roomId: details.room.id,
        pollId: poll.poll.id,
        option: poll.poll.options[1].id
      }),
      /rejected/i
    )

    await member.dispatch('room.leave', { roomId: details.room.id })
    await waitFor(() => !member.requireRoom(details.room.id).base.writable, 'voluntary leave')
    const rejoined = await member.dispatch('room.join', { code: details.invite.code })
    assert.equal(rejoined.room.id, details.room.id)
    assert.equal(member.requireRoom(details.room.id).base.writable, true)
    await waitFor(() => Boolean(member.requireRoom(details.room.id).pairMember), 'member admission service')
    await assert.rejects(
      member.dispatch('room.invite.regenerate', { roomId: details.room.id }),
      /rejected/i
    )
    await assert.rejects(
      member.dispatch('room.invite.revoke', { roomId: details.room.id }),
      /rejected/i
    )
    const rejoinedRoom = member.requireRoom(details.room.id)
    const rejoinedSession = await member.dispatch('session.get', null)
    const rejoinedWriterKey = b4a.toString(rejoinedRoom.base.local.key, 'hex')
    await Promise.all([
      creatorRoom.base.ack(),
      rejoinedRoom.base.ack(),
      third.requireRoom(details.room.id).base.ack()
    ])
    await waitFor(async () => {
      await creatorRoom.base.update()
      await rejoinedRoom.base.update()
      const projectedMember = await valueAt(creatorRoom.view, `member/${rejoinedSession.userId}`)
      return rejoinedRoom.base.writable &&
        projectedMember?.active === true &&
        projectedMember.writerKey === rejoinedWriterKey
    }, 'authenticated member writer authorization')

    const creatorSession = await creator.dispatch('session.get', null)
    await creator.close()
    const whileCreatorOffline = await member.dispatch('room.message.send', {
      roomId: details.room.id,
      input: { text: 'creator temporarily offline' }
    })
    assert.equal(whileCreatorOffline.text, 'creator temporarily offline')

    offlineMember = new RoomManager({
      storagePath: path.join(root, 'offline-member'),
      displayName: 'Offline joiner',
      fixtureFeedKey: publisher.key,
      deviceSecret: offlineDeviceSecret,
      bootstrap: testnet.bootstrap
    })
    await offlineMember.open()
    await waitFor(async () => Boolean(await offlineMember.dispatch('fixture.get', { fixtureId: fixture.id })), 'offline joiner fixture verification')
    const admittedWhileCreatorOffline = await offlineMember.dispatch('room.join', { code: details.invite.code })
    assert.equal(admittedWhileCreatorOffline.room.id, details.room.id)
    assert.equal(await offlineMember.requireRoom(details.room.id)._hasLocalMembership(), true)
    const offlineJoinMessage = await offlineMember.dispatch('room.message.send', {
      roomId: details.room.id,
      input: { text: 'admitted by an ordinary member' }
    })
    assert.equal(offlineJoinMessage.text, 'admitted by an ordinary member')
    assert.equal(
      (await offlineMember.dispatch('room.state', { roomId: details.room.id })).items
        .some((item) => item.kind === 'text' && item.text === 'admitted by an ordinary member'),
      true
    )

    restartedCreator = new RoomManager({
      storagePath: path.join(root, 'creator'),
      displayName: 'Ignored on restart',
      fixtureFeedKey: publisher.key,
      deviceSecret: creatorDeviceSecret,
      bootstrap: testnet.bootstrap
    })
    await restartedCreator.open()
    assert.equal((await restartedCreator.dispatch('session.get', null)).userId, creatorSession.userId)
    let recoveredState = null
    try {
      await waitFor(async () => {
        try {
          const restartedRoom = await restartedCreator.ensureRoom(details.room.id)
          await restartedRoom.base.update()
          await restartedRoom.base.ack()
          await offlineMember.requireRoom(details.room.id).base.update()
          recoveredState = await restartedCreator.dispatch('room.state', { roomId: details.room.id })
          return recoveredState.items.some((item) => item.kind === 'text' && item.text === 'creator temporarily offline')
        } catch {
          return false
        }
      }, 'message written while the creator was offline', 10_000)
    } catch (error) {
      throw new Error(`${error.message}; recovered=${JSON.stringify(recoveredState?.items?.map((item) => item.text || item.poll?.question))}`)
    }

    const regenerated = await restartedCreator.dispatch('room.invite.regenerate', { roomId: details.room.id })
    assert.notEqual(regenerated.id, details.invite.id)
    lateMember = new RoomManager({
      storagePath: path.join(root, 'late-member'),
      displayName: 'Late member',
      fixtureFeedKey: publisher.key,
      deviceSecret: lateDeviceSecret,
      bootstrap: testnet.bootstrap
    })
    await lateMember.open()
    await waitFor(async () => Boolean(await lateMember.dispatch('fixture.get', { fixtureId: fixture.id })), 'late member fixture verification')
    let replicatedInviteId = null
    try {
      await waitFor(async () => {
        replicatedInviteId = (await member.dispatch('room.details', { roomId: details.room.id }))?.invite?.id || null
        return replicatedInviteId === regenerated.id
      }, 'rotated invite replication')
    } catch (error) {
      const creatorRoomAfterRestart = restartedCreator.requireRoom(details.room.id)
      const memberRoom = member.requireRoom(details.room.id)
      throw new Error(`${error.message}; expected=${regenerated.id}; memberInvite=${replicatedInviteId}; creatorLength=${creatorRoomAfterRestart.base.length}; creatorSignedLength=${creatorRoomAfterRestart.base.signedLength}; memberLength=${memberRoom.base.length}; memberSignedLength=${memberRoom.base.signedLength}; creatorConnections=${restartedCreator.swarm.connections.size}; memberConnections=${member.swarm.connections.size}; creatorDiscovery=${b4a.toString(creatorRoomAfterRestart.base.discoveryKey, 'hex')}; memberDiscovery=${b4a.toString(memberRoom.base.discoveryKey, 'hex')}`)
    }
    await assert.rejects(lateMember.dispatch('room.join', { code: details.invite.code }), /rejected/i)
    const lateJoin = await lateMember.dispatch('room.join', { code: regenerated.code })
    assert.equal(lateJoin.room.id, details.room.id)

    // Reproduce a process interruption after the encrypted namespace and
    // writer admission exist but before the account room catalog survives.
    // A retry must authenticate through Blind Pairing with that same writer;
    // it must neither erase the namespace nor invent a local room record.
    interruptedMember = new RoomManager({
      storagePath: path.join(root, 'interrupted-member'),
      displayName: 'Interrupted member',
      fixtureFeedKey: publisher.key,
      deviceSecret: interruptedDeviceSecret,
      bootstrap: testnet.bootstrap
    })
    await interruptedMember.open()
    await waitFor(async () => Boolean(await interruptedMember.dispatch('fixture.get', { fixtureId: fixture.id })), 'interrupted member fixture verification')
    const interruptedJoin = await interruptedMember.dispatch('room.join', { code: regenerated.code })
    assert.equal(interruptedJoin.room.id, details.room.id)
    await interruptedMember.suspendRoom(details.room.id)
    await interruptedMember.account.db.del(`room/${details.room.id}`)
    await interruptedMember.close()
    interruptedMember = new RoomManager({
      storagePath: path.join(root, 'interrupted-member'),
      displayName: 'Ignored on interrupted restart',
      fixtureFeedKey: publisher.key,
      deviceSecret: interruptedDeviceSecret,
      bootstrap: testnet.bootstrap
    })
    await interruptedMember.open()
    assert.equal((await interruptedMember.dispatch('room.list', null)).length, 0)
    const recoveredInterruptedJoin = await interruptedMember.dispatch('room.join', { code: regenerated.code })
    assert.equal(recoveredInterruptedJoin.room.id, details.room.id)
    assert.equal((await interruptedMember.dispatch('room.list', null)).length, 1)

    const lateSession = await lateMember.dispatch('session.get', null)
    let admittedMemberIds = []
    try {
      await waitFor(async () => {
        const creatorRoomAfterJoin = restartedCreator.requireRoom(details.room.id)
        await lateMember.requireRoom(details.room.id).base.update()
        await creatorRoomAfterJoin.base.update()
        await creatorRoomAfterJoin.base.ack()
        try {
          const state = await restartedCreator.dispatch('room.state', { roomId: details.room.id })
          admittedMemberIds = state.members.map((roomMember) => roomMember.userId)
          return admittedMemberIds.includes(lateSession.userId)
        } catch {
          return false
        }
      }, 'late member admission replication')
    } catch (error) {
      const creatorRoomAfterJoin = restartedCreator.requireRoom(details.room.id)
      const lateRoom = lateMember.requireRoom(details.room.id)
      throw new Error(`${error.message}; expectedMember=${lateSession.userId}; creatorMembers=${admittedMemberIds.join(',')}; creatorLength=${creatorRoomAfterJoin.base.length}; creatorSignedLength=${creatorRoomAfterJoin.base.signedLength}; lateLength=${lateRoom.base.length}; lateSignedLength=${lateRoom.base.signedLength}; creatorConnections=${restartedCreator.swarm.connections.size}; lateConnections=${lateMember.swarm.connections.size}`)
    }
    await restartedCreator.dispatch('room.member.remove', {
      roomId: details.room.id,
      userId: lateSession.userId
    })
    await waitFor(() => !lateMember.requireRoom(details.room.id).base.writable, 'banned writer removal')
    await assert.rejects(lateMember.dispatch('room.join', { code: regenerated.code }), /rejected|used/i)

    await restartedCreator.dispatch('room.member.remove', {
      roomId: details.room.id,
      userId: memberSession.userId
    })
    await waitFor(() => !member.requireRoom(details.room.id).base.writable, 'writer removal')
    await assert.rejects(
      member.dispatch('room.message.send', {
        roomId: details.room.id,
        input: { text: 'should not append' }
      }),
      /write access|applying the room change/i
    )
    assert.equal(
      (await restartedCreator.dispatch('room.state', { roomId: details.room.id })).items
        .some((item) => item.kind === 'text' && item.text === 'should not append'),
      false
    )

    const restored = await restartedCreator.dispatch('room.state', { roomId: details.room.id })
    assert.equal(restored.items.some((item) => item.kind === 'text' && item.text === 'hello over Autobase'), true)

    await restartedCreator.dispatch('room.invite.revoke', { roomId: details.room.id })
    await waitFor(() => {
      return !restartedCreator.requireRoom(details.room.id).pairMember &&
        !offlineMember.requireRoom(details.room.id).pairMember
    }, 'revoked invite admission services to stop')
  } finally {
    await Promise.allSettled([
      creator.close(),
      member.close(),
      third.close(),
      restartedCreator?.close(),
      offlineMember?.close(),
      lateMember?.close(),
      interruptedMember?.close()
    ])
    await publisher.close()
    await testnet.destroy().catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
    creatorDeviceSecret.fill(0)
    memberDeviceSecret.fill(0)
    thirdDeviceSecret.fill(0)
    offlineDeviceSecret.fill(0)
    lateDeviceSecret.fill(0)
    interruptedDeviceSecret.fill(0)
  }
})

async function waitFor (predicate, label, timeoutMs = 35_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${label}`)
}
