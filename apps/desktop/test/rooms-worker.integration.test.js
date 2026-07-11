'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const FramedStream = require('framed-stream')
const createTestnet = require('hyperdht/testnet')
const PearRuntime = require('pear-runtime')

const { encodeRoomFrame, parseRoomFrame, validateEvent, validateResponse } = require('../lib/room-protocol.js')
const { encodeWorkerBootstrap } = require('../lib/worker-bootstrap.js')
const { SignedFixturePublisher } = require('./signed-fixture-publisher.js')

const enabled = process.env.FULLTIME_RUN_PEAR_INTEGRATION === '1'

test('PearRuntime Bare room worker serves the v2 IPC boundary', {
  skip: enabled ? false : 'set FULLTIME_RUN_PEAR_INTEGRATION=1 to run PearRuntime with a local DHT',
  timeout: 60_000
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fulltime-room-worker-'))
  const testnet = await createTestnet(3, { host: '127.0.0.1' })
  const fixture = {
    id: 'bare-fixture',
    competition: 'Test Cup',
    home: { id: 'a', name: 'Alpha' },
    away: { id: 'b', name: 'Beta' },
    kickoff: Date.now() + 60_000,
    status: 'scheduled'
  }
  const publisher = new SignedFixturePublisher({
    storagePath: path.join(root, 'fixture-publisher'),
    bootstrap: testnet.bootstrap
  })
  await publisher.open()
  await publisher.publishFixture(fixture)
  const worker = PearRuntime.run(require.resolve('../workers/rooms.js'), [
    '--storage', path.join(root, 'room-worker'),
    '--name', 'Bare fan',
    '--fixture-feed-key', publisher.key,
    '--bootstrap', JSON.stringify(testnet.bootstrap)
  ])
  const pipe = new FramedStream(worker, { bits: 24 })
  const deviceSecret = crypto.randomBytes(32)
  const frames = []
  const waiters = new Set()
  let stderr = ''
  worker.stderr?.on('data', (data) => { stderr += data.toString() })
  pipe.on('data', (data) => {
    const frame = parseRoomFrame(data)
    if (Object.hasOwn(frame, 'ok')) validateResponse(frame)
    else validateEvent(frame)
    frames.push(frame)
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(frame)) continue
      waiters.delete(waiter)
      waiter.resolve(frame)
    }
  })

  const waitFor = (predicate, label, timeoutMs = 15_000) => {
    const found = frames.find(predicate)
    if (found) return Promise.resolve(found)
    let waiter
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(waiter)
        reject(new Error(`${label} timed out${stderr ? `: ${stderr}` : ''}`))
      }, timeoutMs)
      waiter = {
        predicate,
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        }
      }
      waiters.add(waiter)
    })
  }
  const request = async (action, payload) => {
    const id = crypto.randomUUID()
    const waiting = waitFor((frame) => frame.id === id, action)
    pipe.write(Buffer.from(encodeRoomFrame({ version: 2, id, action, payload })))
    const response = await waiting
    if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
    return response.result
  }

  try {
    pipe.write(Buffer.from(encodeWorkerBootstrap(deviceSecret)))
    deviceSecret.fill(0)
    await waitFor((frame) => frame.type === 'bridge.ready', 'bridge.ready')
    const session = await request('session.get', null)
    assert.equal(session.displayName, 'Bare fan')
    const fixtureDeadline = Date.now() + 35_000
    let verifiedFixture = null
    while (!verifiedFixture && Date.now() < fixtureDeadline) {
      verifiedFixture = await request('fixture.get', { fixtureId: fixture.id })
      if (!verifiedFixture) await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(
      verifiedFixture?.fixture.id,
      fixture.id,
      `fixture feed did not replicate into Bare worker; stderr=${stderr}; events=${JSON.stringify(frames.filter((frame) => frame.type))}`
    )
    assert.equal((await waitFor((frame) => frame.type === 'fixture.updated', 'fixture.updated')).fixtureId, fixture.id)
    const details = await request('room.create', {
      fixtureId: fixture.id,
      roomName: 'Bare room',
      displayName: 'Bare fan'
    })
    assert.equal(details.invite.status, 'active')
    const message = await request('room.message.send', {
      roomId: details.room.id,
      input: { text: 'from Bare' }
    })
    assert.equal(message.text, 'from Bare')
    const history = await request('room.history.page', {
      roomId: details.room.id,
      limit: 1
    })
    assert.equal(history.items.length, 1)
    assert.equal(history.items[0].id, message.id)
    assert.equal(typeof history.hasMore, 'boolean')
    const poll = await request('room.poll.create', {
      roomId: details.room.id,
      input: { question: 'Who scores next?', options: ['Home', 'Away'] }
    })
    assert.equal(poll.kind, 'poll')
    assert.equal(poll.poll.options.length, 2)
    const reply = await request('room.reply.send', {
      roomId: details.room.id,
      itemId: message.id,
      input: { text: 'paged reply' }
    })
    const thread = await request('room.thread.page', {
      roomId: details.room.id,
      itemId: message.id,
      limit: 1
    })
    assert.equal(thread.items[0].id, reply.id)
    await request('system.close', null)
  } finally {
    deviceSecret.fill(0)
    pipe.destroy()
    worker.destroy()
    await publisher.close()
    await testnet.destroy().catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
})
