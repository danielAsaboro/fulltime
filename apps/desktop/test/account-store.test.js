'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const Corestore = require('corestore')
const crypto = require('hypercore-crypto')
const Hyperbee = require('hyperbee')

const { userIdFromPublicKey } = require('../lib/room-identity.js')
const { AccountStore } = require('../workers/account-store.js')

test('account identity and profile survive restarts while room keys remain path-safe', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fulltime-account-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const deviceSecret = crypto.randomBytes(32)

  let rootStore = new Corestore(directory)
  let account = new AccountStore(rootStore, 'Ada', { deviceSecret })
  await account.ready()
  const firstSession = account.session()
  const storedIdentity = await account.db.get('account/identity')
  assert.equal(Object.hasOwn(storedIdentity.value, 'seed'), false)
  assert.equal(storedIdentity.value.algorithm, 'xsalsa20-poly1305-v1')
  await account.putRoom({ roomId: 'room-account-1', version: 99, bootstrapKey: 'aa' })
  assert.equal((await account.getRoom('room-account-1')).version, 1)
  await account.updatePersonal('room-account-1', { lastReadItemId: 'item-1' })
  assert.equal((await account.getPersonal('room-account-1')).lastReadItemId, 'item-1')
  await assert.rejects(
    account.updatePersonal('room-account-1', { obsoletePreference: true }),
    /unsupported/
  )
  await account.db.put('personal/room-account-1', {
    version: 1,
    roomId: 'room-account-1',
    lastReadItemId: 'item-1',
    notificationSettings: { messages: true },
    obsoletePreference: true,
    reports: [{ reason: 'legacy local-only report', reportedAt: 1 }]
  })
  assert.throws(() => account.getRoom('../escape'), /Room ID is invalid/)
  await account.close()
  await rootStore.close()

  rootStore = new Corestore(directory)
  account = new AccountStore(rootStore, 'A different launch name', { deviceSecret })
  await account.ready()
  assert.deepEqual(account.session(), firstSession)
  assert.equal((await account.listRooms()).length, 1)
  assert.deepEqual(await account.getPersonal('room-account-1'), {
    version: 1,
    roomId: 'room-account-1',
    lastReadItemId: 'item-1'
  })
  await account.signOut()
  assert.equal(account.session(), null)
  const signedIn = await account.signIn('  Grace   Fan ')
  assert.equal(signedIn.userId, firstSession.userId)
  assert.equal(signedIn.displayName, 'Grace Fan')
  await account.close()
  await rootStore.close()
  deviceSecret.fill(0)
})

test('a legacy plaintext identity migrates once to the device-sealed record', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fulltime-account-migrate-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const deviceSecret = crypto.randomBytes(32)
  const legacySeed = crypto.randomBytes(32)
  const rootStore = new Corestore(directory)
  const local = rootStore.namespace('fulltime-local-account-v1')
  const db = new Hyperbee(local.get({ name: 'catalog' }), {
    extension: false,
    keyEncoding: 'utf-8',
    valueEncoding: 'json'
  })
  await db.ready()
  await db.put('account/identity', {
    version: 1,
    seed: legacySeed.toString('hex'),
    createdAt: 1
  })
  await db.close()
  await local.close()

  const account = new AccountStore(rootStore, 'Migrated fan', { deviceSecret })
  await account.ready()
  assert.equal(account.userId, userIdFromPublicKey(crypto.keyPair(legacySeed).publicKey))
  const migrated = await account.db.get('account/identity')
  assert.equal(Object.hasOwn(migrated.value, 'seed'), false)
  assert.equal(migrated.value.version, 2)
  await account.close()
  await rootStore.close()
  deviceSecret.fill(0)
  legacySeed.fill(0)
})
