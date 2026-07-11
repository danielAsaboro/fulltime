'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const b4a = require('b4a')
const Corestore = require('corestore')
const crypto = require('hypercore-crypto')

const {
  EncryptedMediaStore,
  MAX_TEXT_BYTES,
  MEDIA_CIPHER_MAC_BYTES,
  MEDIA_PLAINTEXT_CHUNK_BYTES,
  mediaCoreName,
  validateMediaDescriptor
} = require('../lib/encrypted-media.js')

const ROOM_ID = 'room_media_test'
const WRITER_ID = 'peer_media_writer'
const READER_ID = 'peer_media_reader'
const EPOCH = 3

test('encrypted media uses one authenticated Hypercore block per plaintext chunk and survives restart', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fulltime-media-persist-'))
  const epochKey = crypto.randomBytes(32)
  const plaintext = b4a.alloc(MEDIA_PLAINTEXT_CHUNK_BYTES + 4_777, 'a')
  let store = new Corestore(directory)
  let media = new EncryptedMediaStore({
    store,
    roomId: ROOM_ID,
    authorId: WRITER_ID,
    epoch: EPOCH,
    epochKey
  })

  try {
    const descriptor = await media.put({
      name: 'match-notes.txt',
      source: irregularChunks(plaintext)
    })
    assert.deepEqual(validateMediaDescriptor(descriptor), descriptor)
    assert.equal(descriptor.coreKey, media.coreKey)
    assert.equal(descriptor.blob.blockLength, 2)
    assert.equal(descriptor.blob.byteLength, plaintext.byteLength + 2 * MEDIA_CIPHER_MAC_BYTES)
    assert.deepEqual(media.binding, {
      epoch: EPOCH,
      authorId: WRITER_ID,
      coreKey: descriptor.coreKey
    })

    const firstCipherBlock = await media.core.get(descriptor.blob.blockOffset)
    const secondCipherBlock = await media.core.get(descriptor.blob.blockOffset + 1)
    assert.equal(firstCipherBlock.byteLength, MEDIA_PLAINTEXT_CHUNK_BYTES + MEDIA_CIPHER_MAC_BYTES)
    assert.equal(secondCipherBlock.byteLength, 4_777 + MEDIA_CIPHER_MAC_BYTES)
    assert.equal(firstCipherBlock.includes(b4a.from('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')), false)
    assert.notDeepEqual(firstCipherBlock.subarray(0, 64), plaintext.subarray(0, 64))

    assert.deepEqual(await media.get(descriptor), plaintext)
    const yielded = []
    for await (const chunk of media.readChunks(descriptor)) yielded.push(chunk)
    assert.deepEqual(yielded.map((chunk) => chunk.byteLength), [MEDIA_PLAINTEXT_CHUNK_BYTES, 4_777])
    assert.deepEqual(b4a.concat(yielded), plaintext)

    const coreKey = media.coreKey
    await media.close()
    await store.close()

    store = new Corestore(directory)
    media = new EncryptedMediaStore({
      store,
      roomId: ROOM_ID,
      authorId: WRITER_ID,
      epoch: EPOCH,
      epochKey
    })
    await media.ready()
    assert.equal(media.coreKey, coreKey)
    assert.deepEqual(await media.get(descriptor), plaintext)
    assert.equal(mediaCoreName(ROOM_ID, WRITER_ID, EPOCH), mediaCoreName(ROOM_ID, WRITER_ID, EPOCH))
    assert.notEqual(mediaCoreName(ROOM_ID, WRITER_ID, EPOCH), mediaCoreName(ROOM_ID, WRITER_ID, EPOCH + 1))
  } finally {
    await media.close().catch(() => {})
    await store.close().catch(() => {})
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('a pinned remote Hyperblob replicates through the real Corestore protocol and is verified before return', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fulltime-media-replication-'))
  const writerStore = new Corestore(path.join(root, 'writer'))
  const readerStore = new Corestore(path.join(root, 'reader'))
  const epochKey = crypto.randomBytes(32)
  const writer = new EncryptedMediaStore({
    store: writerStore,
    roomId: ROOM_ID,
    authorId: WRITER_ID,
    epoch: EPOCH,
    epochKey
  })
  const reader = new EncryptedMediaStore({
    store: readerStore,
    roomId: ROOM_ID,
    authorId: READER_ID,
    epoch: EPOCH,
    epochKey,
    readTimeoutMs: 10_000
  })
  const writerReplication = writerStore.replicate(true)
  const readerReplication = readerStore.replicate(false)
  writerReplication.pipe(readerReplication).pipe(writerReplication)

  try {
    const plaintext = b4a.from('A real replicated and encrypted FullTime room attachment.\n'.repeat(2_000))
    const descriptor = await writer.put({ name: 'away-end-notes.txt', source: plaintext })
    const received = await reader.get(descriptor)
    assert.deepEqual(received, plaintext)

    const forgedHash = { ...descriptor, plaintextHash: '00'.repeat(32) }
    await assert.rejects(reader.get(forgedHash), /plaintext hash/)

    const forgedMime = { ...descriptor, mimeType: 'application/pdf' }
    await assert.rejects(reader.get(forgedMime), /metadata/)

    const nonce = descriptor.encryption.noncePrefix
    const forgedNonce = `${nonce[0] === '0' ? '1' : '0'}${nonce.slice(1)}`
    await assert.rejects(reader.get({
      ...descriptor,
      encryption: { ...descriptor.encryption, noncePrefix: forgedNonce }
    }), /failed authentication/)

    const wrongRoom = new EncryptedMediaStore({
      store: readerStore,
      roomId: 'room_wrong_context',
      authorId: 'peer_wrong_context',
      epoch: EPOCH,
      epochKey,
      readTimeoutMs: 10_000
    })
    try {
      await assert.rejects(wrongRoom.get(descriptor), /failed authentication/)
    } finally {
      await wrongRoom.close()
    }

    const wrongEpochKey = new EncryptedMediaStore({
      store: readerStore,
      roomId: ROOM_ID,
      authorId: 'peer_wrong_epoch_key',
      epoch: EPOCH,
      epochKey: crypto.randomBytes(32),
      readTimeoutMs: 10_000
    })
    try {
      await assert.rejects(wrongEpochKey.get(descriptor), /failed authentication/)
    } finally {
      await wrongEpochKey.close()
    }
  } finally {
    writerReplication.destroy()
    readerReplication.destroy()
    await Promise.allSettled([writer.close(), reader.close()])
    await Promise.allSettled([writerStore.close(), readerStore.close()])
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('media validation happens before append and rejects unsafe, disguised, oversized, or malformed input', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fulltime-media-validation-'))
  const store = new Corestore(directory)
  const media = new EncryptedMediaStore({
    store,
    roomId: ROOM_ID,
    authorId: WRITER_ID,
    epoch: EPOCH,
    epochKey: crypto.randomBytes(32)
  })

  try {
    await media.ready()
    const duplicate = new EncryptedMediaStore({
      store,
      roomId: ROOM_ID,
      authorId: WRITER_ID,
      epoch: EPOCH,
      epochKey: crypto.randomBytes(32)
    })
    await assert.rejects(duplicate.ready(), /already open/)
    await duplicate.close()
    const initialLength = media.core.length
    await assert.rejects(media.put({ name: '../secret.txt', source: b4a.from('secret') }), /unsafe/)
    await assert.rejects(media.put({ name: 'vector.txt', source: b4a.from('<svg><script>alert(1)</script></svg>') }), /unsupported or malformed/)
    await assert.rejects(media.put({ name: 'bad.txt', source: b4a.from([0xc3, 0x28]) }), /unsupported or malformed/)
    await assert.rejects(media.put({ name: 'huge.txt', source: b4a.alloc(MAX_TEXT_BYTES + 1, 'x') }), /text\/plain exceeds/)
    await assert.rejects(media.put({
      name: 'numbers.txt',
      source: (function * () { yield 42 })()
    }), /non-byte chunk/)
    assert.equal(media.core.length, initialLength)

    assert.throws(() => validateMediaDescriptor({ unexpected: true }), /missing version/)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(media.put({ name: 'cancelled.txt', source: b4a.from('cancelled'), signal: controller.signal }), { name: 'AbortError' })
    assert.equal(media.core.length, initialLength)

    await media.close()
    await assert.rejects(media.put({ name: 'closed.txt', source: b4a.from('closed') }), /closed/)
  } finally {
    await media.close().catch(() => {})
    await store.close().catch(() => {})
    await fs.rm(directory, { recursive: true, force: true })
  }
})

async function * irregularChunks (bytes) {
  const sizes = [1, 31, 1_337, 65_000, 19, 4_096]
  let offset = 0
  let index = 0
  while (offset < bytes.byteLength) {
    const size = sizes[index++ % sizes.length]
    yield bytes.subarray(offset, Math.min(offset + size, bytes.byteLength))
    offset += size
  }
}
