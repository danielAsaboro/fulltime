'use strict'

const b4a = require('b4a')
const Hyperblobs = require('hyperblobs')
const crypto = require('hypercore-crypto')
const sodium = require('sodium-universal')

// These values are part of packages/shared/src/media.ts. Keep this Bare-runtime
// implementation byte-for-byte compatible with that public descriptor contract.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_TEXT_BYTES = 1024 * 1024
const MAX_IMAGE_DIMENSION = 12_000
const MAX_IMAGE_PIXELS = 40_000_000
const MEDIA_PLAINTEXT_CHUNK_BYTES = 64 * 1024
const MEDIA_CIPHER_MAC_BYTES = sodium.crypto_secretbox_MACBYTES
const MEDIA_CIPHER_CHUNK_BYTES = MEDIA_PLAINTEXT_CHUNK_BYTES + MEDIA_CIPHER_MAC_BYTES
const DEFAULT_READ_TIMEOUT_MS = 30_000
const DEFAULT_MAX_CONCURRENT_READS = 4

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,179}$/
const HEX_32 = /^[a-f0-9]{64}$/
const MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain'
])
const MEDIA_KEY_CONTEXT = b4a.from('fulltime/room-media/secretbox-key/v1')
const MEDIA_CORE_CONTEXT = b4a.from('fulltime/room-media/core-name/v1')
const ACTIVE_LOCAL_CORES = new WeakMap()

class EncryptedMediaStore {
  constructor ({
    store,
    roomId,
    authorId,
    epoch,
    epochKey,
    readTimeoutMs = DEFAULT_READ_TIMEOUT_MS,
    maxConcurrentReads = DEFAULT_MAX_CONCURRENT_READS
  }) {
    if (!store || typeof store.get !== 'function') throw new TypeError('Media Corestore is invalid')
    this.store = store
    this.roomId = identifier(roomId, 'Room ID')
    this.authorId = identifier(authorId, 'Media author')
    this.epoch = safeInteger(epoch, 'Media epoch', 0)
    this.epochKey = copySecretKey(epochKey)
    this.readTimeoutMs = safeInteger(readTimeoutMs, 'Media read timeout', 1)
    this.maxConcurrentReads = safeInteger(maxConcurrentReads, 'Media read concurrency', 1)

    this.core = null
    this.blobs = null
    this.localCoreName = null
    this.opening = null
    this.closed = false
    this.closing = null
    this.activeReads = 0
    this.activeWrite = false
    this.remoteSessions = new Set()
    this.writeStreams = new Set()
  }

  async ready () {
    this._assertOpen()
    if (this.core) return this
    if (!this.opening) this.opening = this._open()
    await this.opening
    return this
  }

  async _open () {
    const name = mediaCoreName(this.roomId, this.authorId, this.epoch)
    if (!claimLocalCore(this.store, name)) {
      throw new Error('This member media core is already open; reuse its EncryptedMediaStore')
    }
    this.localCoreName = name
    const core = this.store.get({ name, exclusive: true })
    try {
      await core.ready()
      this._assertOpen()
      if (!core.writable) throw new Error('Local media core is not writable')
      this.core = core
      this.blobs = new Hyperblobs(core, { blockSize: MEDIA_CIPHER_CHUNK_BYTES })
    } catch (error) {
      await core.close().catch(noop)
      releaseLocalCore(this.store, name)
      this.localCoreName = null
      throw error
    }
  }

  get coreKey () {
    if (!this.core || !this.core.opened) throw new Error('Encrypted media store is not ready')
    return b4a.toString(this.core.key, 'hex')
  }

  get binding () {
    return {
      epoch: this.epoch,
      authorId: this.authorId,
      coreKey: this.coreKey
    }
  }

  async put ({ mediaId = createMediaId(), name, source, signal = null }) {
    await this.ready()
    this._assertOpen()
    if (this.activeWrite) throw new Error('A media import is already in progress for this member epoch')
    this.activeWrite = true

    let plaintext = null
    let writer = null
    try {
      const normalizedId = identifier(mediaId, 'Media ID')
      const normalizedName = mediaName(name)
      plaintext = await collectBoundedSource(source, signal, () => this._assertOpen())
      const sniffed = sniffMedia(plaintext)
      throwIfAborted(signal)

      const hash = b4a.alloc(32)
      sodium.crypto_generichash(hash, plaintext)
      const noncePrefix = crypto.randomBytes(16)
      const contentKey = deriveContentKey({
        epochKey: this.epochKey,
        roomId: this.roomId,
        authorId: this.authorId,
        epoch: this.epoch,
        coreKey: this.core.key
      })

      writer = this.blobs.createWriteStream()
      this.writeStreams.add(writer)
      const completion = streamCompletion(writer)
      let chunkIndex = 0
      try {
        for (let offset = 0; offset < plaintext.byteLength; offset += MEDIA_PLAINTEXT_CHUNK_BYTES) {
          this._assertOpen()
          throwIfAborted(signal)
          const chunk = plaintext.subarray(offset, offset + MEDIA_PLAINTEXT_CHUNK_BYTES)
          const ciphertext = b4a.alloc(chunk.byteLength + MEDIA_CIPHER_MAC_BYTES)
          const nonce = chunkNonce(noncePrefix, chunkIndex)
          sodium.crypto_secretbox_easy(ciphertext, chunk, nonce, contentKey)
          await writeBlock(writer, ciphertext)
          chunkIndex++
        }
        writer.end()
        await completion
      } catch (error) {
        writer.destroy(error)
        await completion.catch(noop)
        throw error
      } finally {
        contentKey.fill(0)
        this.writeStreams.delete(writer)
      }

      const descriptor = {
        version: 1,
        epoch: this.epoch,
        mediaId: normalizedId,
        authorId: this.authorId,
        coreKey: this.coreKey,
        blob: {
          blockOffset: writer.id.blockOffset,
          blockLength: writer.id.blockLength,
          byteOffset: writer.id.byteOffset,
          byteLength: writer.id.byteLength
        },
        encryption: {
          algorithm: 'xsalsa20-poly1305-chunked-v1',
          noncePrefix: b4a.toString(noncePrefix, 'hex'),
          plaintextChunkBytes: MEDIA_PLAINTEXT_CHUNK_BYTES
        },
        plaintextHash: b4a.toString(hash, 'hex'),
        hashAlgorithm: 'blake2b-256',
        mimeType: sniffed.mimeType,
        name: normalizedName,
        sizeBytes: sniffed.sizeBytes,
        ...(sniffed.width === undefined ? {} : { width: sniffed.width, height: sniffed.height })
      }
      return validateMediaDescriptor(descriptor)
    } finally {
      if (plaintext) plaintext.fill(0)
      this.activeWrite = false
    }
  }

  async get (descriptor, options = {}) {
    return this._downloadVerified(descriptor, options)
  }

  async * readChunks (descriptor, options = {}) {
    const plaintext = await this._downloadVerified(descriptor, options)
    for (let offset = 0; offset < plaintext.byteLength; offset += MEDIA_PLAINTEXT_CHUNK_BYTES) {
      yield plaintext.subarray(offset, offset + MEDIA_PLAINTEXT_CHUNK_BYTES)
    }
  }

  async _downloadVerified (value, { signal = null, timeoutMs = this.readTimeoutMs } = {}) {
    await this.ready()
    this._assertOpen()
    const descriptor = validateMediaDescriptor(value)
    if (descriptor.epoch !== this.epoch) {
      throw new Error(`Media belongs to epoch ${descriptor.epoch}; this store has epoch ${this.epoch}`)
    }
    const timeout = safeInteger(timeoutMs, 'Media read timeout', 1)
    if (this.activeReads >= this.maxConcurrentReads) throw new Error('Too many concurrent media downloads')
    throwIfAborted(signal)
    this.activeReads++

    const coreKey = b4a.from(descriptor.coreKey, 'hex')
    let core = null
    let plaintext = null
    try {
      core = this.store.get({ key: coreKey, wait: true, timeout })
      this.remoteSessions.add(core)
      await core.ready()
      this._assertOpen()
      throwIfAborted(signal)
      if (!b4a.equals(core.key, coreKey)) throw new Error('Opened media core does not match its pinned key')

      const contentKey = deriveContentKey({
        epochKey: this.epochKey,
        roomId: this.roomId,
        authorId: descriptor.authorId,
        epoch: descriptor.epoch,
        coreKey
      })
      try {
        plaintext = await decryptBlob({
          core,
          descriptor,
          contentKey,
          signal,
          timeout,
          assertOpen: () => this._assertOpen()
        })
      } finally {
        contentKey.fill(0)
      }

      verifyPlaintext(descriptor, plaintext)
      return plaintext
    } catch (error) {
      if (plaintext) plaintext.fill(0)
      throw error
    } finally {
      if (core) {
        this.remoteSessions.delete(core)
        await core.close().catch(noop)
      }
      this.activeReads--
    }
  }

  close () {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = this._close()
    return this.closing
  }

  async _close () {
    this.epochKey.fill(0)
    for (const writer of this.writeStreams) writer.destroy(new Error('Encrypted media store closed'))
    if (this.opening) await this.opening.catch(noop)
    const sessions = [...this.remoteSessions]
    this.remoteSessions.clear()
    if (this.core) sessions.push(this.core)
    await Promise.allSettled(sessions.map((core) => core.close()))
    if (this.localCoreName) releaseLocalCore(this.store, this.localCoreName)
    this.localCoreName = null
    this.core = null
    this.blobs = null
  }

  _assertOpen () {
    if (this.closed) throw new Error('Encrypted media store is closed')
  }
}

async function decryptBlob ({ core, descriptor, contentKey, signal, timeout, assertOpen }) {
  const prefix = b4a.from(descriptor.encryption.noncePrefix, 'hex')
  const chunks = []
  let cipherBytes = 0
  let plaintextBytes = 0
  try {
    const start = await core.seek(descriptor.blob.byteOffset, { wait: true, timeout })
    const end = await core.seek(descriptor.blob.byteOffset + descriptor.blob.byteLength, { wait: true, timeout })
    if (!start || start[0] !== descriptor.blob.blockOffset || start[1] !== 0 ||
        !end || end[0] !== descriptor.blob.blockOffset + descriptor.blob.blockLength || end[1] !== 0) {
      throw new Error('Encrypted media byte bounds do not match its pinned core')
    }
    for (let index = 0; index < descriptor.blob.blockLength; index++) {
      assertOpen()
      throwIfAborted(signal)
      const remaining = descriptor.sizeBytes - plaintextBytes
      const expectedPlaintextBytes = Math.min(MEDIA_PLAINTEXT_CHUNK_BYTES, remaining)
      const expectedCipherBytes = expectedPlaintextBytes + MEDIA_CIPHER_MAC_BYTES
      const blockIndex = descriptor.blob.blockOffset + index
      const ciphertext = await core.get(blockIndex, { wait: true, timeout })
      if (!ciphertext) throw new Error(`Encrypted media block ${blockIndex} is unavailable`)
      if (ciphertext.byteLength !== expectedCipherBytes) {
        throw new Error(`Encrypted media block ${blockIndex} has an invalid size`)
      }
      const chunk = b4a.alloc(expectedPlaintextBytes)
      const nonce = chunkNonce(prefix, index)
      if (!sodium.crypto_secretbox_open_easy(chunk, ciphertext, nonce, contentKey)) {
        chunk.fill(0)
        throw new Error(`Encrypted media block ${blockIndex} failed authentication`)
      }
      chunks.push(chunk)
      cipherBytes += ciphertext.byteLength
      plaintextBytes += chunk.byteLength
    }
    if (cipherBytes !== descriptor.blob.byteLength || plaintextBytes !== descriptor.sizeBytes) {
      throw new Error('Encrypted media bounds do not match downloaded blocks')
    }
    return chunks.length === 1 ? chunks[0] : b4a.concat(chunks, plaintextBytes)
  } catch (error) {
    for (const chunk of chunks) chunk.fill(0)
    throw error
  }
}

function verifyPlaintext (descriptor, plaintext) {
  const hash = b4a.alloc(32)
  sodium.crypto_generichash(hash, plaintext)
  if (!constantTimeHexEquals(hash, descriptor.plaintextHash)) {
    throw new Error('Media plaintext hash does not match its descriptor')
  }
  const sniffed = sniffMedia(plaintext)
  if (sniffed.mimeType !== descriptor.mimeType || sniffed.sizeBytes !== descriptor.sizeBytes ||
      sniffed.width !== descriptor.width || sniffed.height !== descriptor.height) {
    throw new Error('Media plaintext metadata does not match its descriptor')
  }
}

function deriveContentKey ({ epochKey, roomId, authorId, epoch, coreKey }) {
  const output = b4a.alloc(sodium.crypto_secretbox_KEYBYTES)
  const context = lengthPrefixed([
    MEDIA_KEY_CONTEXT,
    b4a.from(roomId),
    b4a.from(authorId),
    b4a.from(String(epoch)),
    coreKey
  ])
  sodium.crypto_generichash(output, context, epochKey)
  return output
}

function mediaCoreName (roomIdValue, authorIdValue, epochValue) {
  const roomId = identifier(roomIdValue, 'Room ID')
  const authorId = identifier(authorIdValue, 'Media author')
  const epoch = safeInteger(epochValue, 'Media epoch', 0)
  const digest = b4a.alloc(32)
  sodium.crypto_generichash(digest, lengthPrefixed([
    MEDIA_CORE_CONTEXT,
    b4a.from(roomId),
    b4a.from(authorId),
    b4a.from(String(epoch))
  ]))
  return `fulltime-media-${b4a.toString(digest, 'hex')}`
}

function lengthPrefixed (fields) {
  const output = []
  for (const field of fields) {
    const length = b4a.alloc(4)
    length[0] = (field.byteLength >>> 24) & 0xff
    length[1] = (field.byteLength >>> 16) & 0xff
    length[2] = (field.byteLength >>> 8) & 0xff
    length[3] = field.byteLength & 0xff
    output.push(length, field)
  }
  return b4a.concat(output)
}

function chunkNonce (prefix, indexValue) {
  if (!b4a.isBuffer(prefix) || prefix.byteLength !== 16) throw new TypeError('Media nonce prefix is invalid')
  const index = safeInteger(indexValue, 'Media chunk index', 0)
  const nonce = b4a.alloc(sodium.crypto_secretbox_NONCEBYTES)
  prefix.copy(nonce, 0)
  let remaining = BigInt(index)
  for (let offset = nonce.byteLength - 1; offset >= 16; offset--) {
    nonce[offset] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return nonce
}

async function collectBoundedSource (source, signal, assertOpen) {
  const chunks = []
  let current = b4a.alloc(Math.min(MEDIA_PLAINTEXT_CHUNK_BYTES, MAX_FILE_BYTES))
  let currentOffset = 0
  let total = 0
  try {
    for await (const value of sourceIterable(source)) {
      assertOpen()
      throwIfAborted(signal)
      const incoming = asBytes(value)
      if (incoming.byteLength === 0) continue
      if (total + incoming.byteLength > MAX_FILE_BYTES) {
        throw new TypeError(`Media exceeds ${MAX_FILE_BYTES} bytes`)
      }
      let offset = 0
      while (offset < incoming.byteLength) {
        const copied = Math.min(current.byteLength - currentOffset, incoming.byteLength - offset)
        incoming.copy(current, currentOffset, offset, offset + copied)
        currentOffset += copied
        offset += copied
        total += copied
        if (currentOffset === current.byteLength) {
          chunks.push(current)
          current = b4a.alloc(Math.min(MEDIA_PLAINTEXT_CHUNK_BYTES, MAX_FILE_BYTES - total))
          currentOffset = 0
        }
      }
    }
    if (total === 0) throw new TypeError('Media bytes are empty')
    if (currentOffset > 0) chunks.push(current.subarray(0, currentOffset))
    else current.fill(0)
    const plaintext = chunks.length === 1 ? b4a.from(chunks[0]) : b4a.concat(chunks, total)
    for (const chunk of chunks) chunk.fill(0)
    return plaintext
  } catch (error) {
    current.fill(0)
    for (const chunk of chunks) chunk.fill(0)
    throw error
  }
}

async function * sourceIterable (source) {
  if (b4a.isBuffer(source) || source instanceof Uint8Array) {
    yield source
    return
  }
  if (!source || (typeof source[Symbol.asyncIterator] !== 'function' && typeof source[Symbol.iterator] !== 'function')) {
    throw new TypeError('Media source must be bytes or an iterable of byte chunks')
  }
  for await (const chunk of source) yield chunk
}

function asBytes (value) {
  if (b4a.isBuffer(value)) return value
  if (value instanceof Uint8Array) return b4a.from(value.buffer, value.byteOffset, value.byteLength)
  throw new TypeError('Media source yielded a non-byte chunk')
}

function writeBlock (writer, block) {
  if (writer.write(block)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onDrain = () => {
      writer.off('error', onError)
      resolve()
    }
    const onError = (error) => {
      writer.off('drain', onDrain)
      reject(error)
    }
    writer.once('drain', onDrain)
    writer.once('error', onError)
  })
}

function streamCompletion (stream) {
  return new Promise((resolve, reject) => {
    stream.once('error', reject)
    stream.once('close', resolve)
  })
}

function createMediaId () {
  return `media_${b4a.toString(crypto.randomBytes(16), 'hex')}`
}

function validateMediaDescriptor (value) {
  const input = plainObject(value, 'Media descriptor')
  exactKeys(input, [
    'version', 'epoch', 'mediaId', 'authorId', 'coreKey', 'blob', 'plaintextHash',
    'encryption', 'hashAlgorithm', 'mimeType', 'name', 'sizeBytes'
  ], ['width', 'height'], 'Media descriptor')
  if (input.version !== 1) throw new TypeError('Media descriptor version is unsupported')
  const epoch = safeInteger(input.epoch, 'Media epoch', 0)
  const mediaId = identifier(input.mediaId, 'Media ID')
  const authorId = identifier(input.authorId, 'Media author')
  const coreKey = hex32(input.coreKey, 'Media core key')
  const plaintextHash = hex32(input.plaintextHash, 'Media plaintext hash')
  if (input.hashAlgorithm !== 'blake2b-256') throw new TypeError('Media hash algorithm is unsupported')
  const mimeType = mediaMime(input.mimeType)
  const name = mediaName(input.name)
  const sizeBytes = safeInteger(input.sizeBytes, 'Media size', 1)
  enforceSize(mimeType, sizeBytes)
  const blob = blobBounds(input.blob)
  const encryption = mediaEncryption(input.encryption)
  const expectedBlocks = Math.ceil(sizeBytes / encryption.plaintextChunkBytes)
  const expectedCipherBytes = sizeBytes + expectedBlocks * MEDIA_CIPHER_MAC_BYTES
  if (blob.blockLength !== expectedBlocks || blob.byteLength !== expectedCipherBytes) {
    throw new TypeError('Encrypted media bounds do not match its plaintext size')
  }
  if (!Number.isSafeInteger(blob.blockOffset + blob.blockLength) ||
      !Number.isSafeInteger(blob.byteOffset + blob.byteLength)) {
    throw new TypeError('Encrypted media bounds overflow')
  }

  const image = mimeType.startsWith('image/')
  if (image && (input.width === undefined || input.height === undefined)) {
    throw new TypeError('Image media requires dimensions')
  }
  if (!image && (input.width !== undefined || input.height !== undefined)) {
    throw new TypeError('Non-image media cannot include dimensions')
  }
  const dimensions = image ? validateDimensions(input.width, input.height) : null
  return {
    version: 1,
    epoch,
    mediaId,
    authorId,
    coreKey,
    blob,
    encryption,
    plaintextHash,
    hashAlgorithm: 'blake2b-256',
    mimeType,
    name,
    sizeBytes,
    ...(dimensions || {})
  }
}

function mediaEncryption (value) {
  const input = plainObject(value, 'Media encryption')
  exactKeys(input, ['algorithm', 'noncePrefix', 'plaintextChunkBytes'], [], 'Media encryption')
  if (input.algorithm !== 'xsalsa20-poly1305-chunked-v1') {
    throw new TypeError('Media encryption algorithm is unsupported')
  }
  if (typeof input.noncePrefix !== 'string' || !/^[a-f0-9]{32}$/.test(input.noncePrefix)) {
    throw new TypeError('Media nonce prefix is invalid')
  }
  if (input.plaintextChunkBytes !== MEDIA_PLAINTEXT_CHUNK_BYTES) {
    throw new TypeError('Media plaintext chunk size is unsupported')
  }
  return {
    algorithm: 'xsalsa20-poly1305-chunked-v1',
    noncePrefix: input.noncePrefix,
    plaintextChunkBytes: MEDIA_PLAINTEXT_CHUNK_BYTES
  }
}

function sniffMedia (bytesValue) {
  const bytes = asBytes(bytesValue)
  if (bytes.byteLength < 1) throw new TypeError('Media bytes are empty')
  if (bytes.byteLength > MAX_FILE_BYTES) throw new TypeError(`Media exceeds ${MAX_FILE_BYTES} bytes`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let result = null
  if (isPng(bytes)) result = sniffPng(view, bytes.byteLength)
  else if (isJpeg(bytes)) result = sniffJpeg(bytes)
  else if (isGif(bytes)) result = sniffGif(view, bytes.byteLength)
  else if (isWebp(bytes)) result = sniffWebp(bytes, view)
  else if (isPdf(bytes)) result = { mimeType: 'application/pdf', sizeBytes: bytes.byteLength }
  else if (isCanonicalUtf8Text(bytes)) result = { mimeType: 'text/plain', sizeBytes: bytes.byteLength }
  if (!result) throw new TypeError('Media format is unsupported or malformed')
  enforceSize(result.mimeType, result.sizeBytes)
  if (result.width !== undefined || result.height !== undefined) {
    validateDimensions(result.width, result.height)
  }
  return result
}

function mediaName (value) {
  if (typeof value !== 'string') throw new TypeError('Media name must be text')
  const normalized = value.normalize('NFC').trim()
  if (!normalized || normalized !== value || normalized.length > 255 ||
      /[\u0000-\u001f\u007f/\\]/.test(normalized) || normalized === '.' || normalized === '..') {
    throw new TypeError('Media name is unsafe')
  }
  return normalized
}

function sniffPng (view, sizeBytes) {
  if (view.byteLength < 24 || view.getUint32(12) !== 0x49484452) throw new TypeError('PNG header is malformed')
  return { mimeType: 'image/png', sizeBytes, width: view.getUint32(16), height: view.getUint32(20) }
}

function sniffGif (view, sizeBytes) {
  if (view.byteLength < 10) throw new TypeError('GIF header is malformed')
  return { mimeType: 'image/gif', sizeBytes, width: view.getUint16(6, true), height: view.getUint16(8, true) }
}

function sniffJpeg (bytes) {
  let offset = 2
  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) throw new TypeError('JPEG marker stream is malformed')
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break
    if (offset + 2 > bytes.byteLength) break
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    if (length < 2 || offset + length > bytes.byteLength) throw new TypeError('JPEG segment is malformed')
    if (isJpegFrameMarker(marker)) {
      if (length < 7) throw new TypeError('JPEG frame is malformed')
      return {
        mimeType: 'image/jpeg',
        sizeBytes: bytes.byteLength,
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6]
      }
    }
    offset += length
  }
  throw new TypeError('JPEG dimensions are unavailable')
}

function sniffWebp (bytes, view) {
  if (bytes.byteLength < 30) throw new TypeError('WebP header is malformed')
  const chunk = ascii(bytes, 12, 16)
  if (chunk === 'VP8X') {
    return { mimeType: 'image/webp', sizeBytes: bytes.byteLength, width: 1 + uint24le(bytes, 24), height: 1 + uint24le(bytes, 27) }
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) throw new TypeError('Lossless WebP header is malformed')
    const bits = view.getUint32(21, true)
    return { mimeType: 'image/webp', sizeBytes: bytes.byteLength, width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }
  }
  if (chunk === 'VP8 ') {
    const start = 20
    if (bytes.byteLength < start + 10 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) {
      throw new TypeError('Lossy WebP header is malformed')
    }
    return {
      mimeType: 'image/webp',
      sizeBytes: bytes.byteLength,
      width: ((bytes[start + 7] << 8) | bytes[start + 6]) & 0x3fff,
      height: ((bytes[start + 9] << 8) | bytes[start + 8]) & 0x3fff
    }
  }
  throw new TypeError('WebP chunk is unsupported')
}

function blobBounds (value) {
  const input = plainObject(value, 'Hyperblob bounds')
  exactKeys(input, ['blockOffset', 'blockLength', 'byteOffset', 'byteLength'], [], 'Hyperblob bounds')
  return {
    blockOffset: safeInteger(input.blockOffset, 'Blob block offset', 0),
    blockLength: safeInteger(input.blockLength, 'Blob block length', 1),
    byteOffset: safeInteger(input.byteOffset, 'Blob byte offset', 0),
    byteLength: safeInteger(input.byteLength, 'Blob byte length', 1)
  }
}

function validateDimensions (widthValue, heightValue) {
  const width = safeInteger(widthValue, 'Image width', 1)
  const height = safeInteger(heightValue, 'Image height', 1)
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    throw new TypeError('Image dimensions exceed the room media limit')
  }
  return { width, height }
}

function enforceSize (mime, size) {
  const limit = mime === 'text/plain' ? MAX_TEXT_BYTES : mime.startsWith('image/') ? MAX_IMAGE_BYTES : MAX_FILE_BYTES
  if (size > limit) throw new TypeError(`${mime} exceeds ${limit} bytes`)
}

function mediaMime (value) {
  if (!MIME_TYPES.has(value)) throw new TypeError('Media MIME type is unsupported')
  return value
}

function isPng (bytes) {
  return bytes.byteLength >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    .every((value, index) => bytes[index] === value)
}

function isJpeg (bytes) {
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

function isGif (bytes) {
  const signature = ascii(bytes, 0, 6)
  return signature === 'GIF87a' || signature === 'GIF89a'
}

function isWebp (bytes) {
  return bytes.byteLength >= 16 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP'
}

function isPdf (bytes) {
  return bytes.byteLength >= 8 && ascii(bytes, 0, 5) === '%PDF-'
}

function isCanonicalUtf8Text (bytes) {
  const decoded = b4a.toString(bytes, 'utf8')
  if (decoded.includes('\u0000') || !b4a.equals(b4a.from(decoded, 'utf8'), bytes)) return false
  const trimmed = decoded.trimStart().toLowerCase()
  return !trimmed.startsWith('<html') && !trimmed.startsWith('<!doctype') && !trimmed.startsWith('<svg')
}

function isJpegFrameMarker (marker) {
  return (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)
}

function uint24le (bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function ascii (bytes, start, end) {
  if (end > bytes.byteLength) return ''
  let result = ''
  for (let index = start; index < end; index++) result += String.fromCharCode(bytes[index])
  return result
}

function identifier (value, label) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new TypeError(`${label} is invalid`)
  return value
}

function hex32 (value, label) {
  if (typeof value !== 'string' || !HEX_32.test(value)) throw new TypeError(`${label} is invalid`)
  return value
}

function safeInteger (value, label, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${label} is invalid`)
  return value
}

function plainObject (value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`)
  }
  return value
}

function exactKeys (value, required, optional, label) {
  for (const key of required) if (!Object.hasOwn(value, key)) throw new TypeError(`${label} is missing ${key}`)
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label} field ${key} is unsupported`)
}

function copySecretKey (value) {
  if (!b4a.isBuffer(value) && !(value instanceof Uint8Array)) throw new TypeError('Room epoch key is invalid')
  if (value.byteLength !== sodium.crypto_secretbox_KEYBYTES) throw new TypeError('Room epoch key is invalid')
  const key = b4a.alloc(sodium.crypto_secretbox_KEYBYTES)
  asBytes(value).copy(key)
  return key
}

function constantTimeHexEquals (actual, expectedHex) {
  const expected = b4a.from(expectedHex, 'hex')
  return expected.byteLength === actual.byteLength && sodium.sodium_memcmp(actual, expected)
}

function throwIfAborted (signal) {
  if (signal && signal.aborted) {
    const error = new Error('Media operation was aborted')
    error.name = 'AbortError'
    throw error
  }
}

function noop () {}

function claimLocalCore (store, name) {
  let names = ACTIVE_LOCAL_CORES.get(store)
  if (!names) {
    names = new Set()
    ACTIVE_LOCAL_CORES.set(store, names)
  }
  if (names.has(name)) return false
  names.add(name)
  return true
}

function releaseLocalCore (store, name) {
  const names = ACTIVE_LOCAL_CORES.get(store)
  if (!names) return
  names.delete(name)
  if (names.size === 0) ACTIVE_LOCAL_CORES.delete(store)
}

module.exports = {
  DEFAULT_MAX_CONCURRENT_READS,
  DEFAULT_READ_TIMEOUT_MS,
  EncryptedMediaStore,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_TEXT_BYTES,
  MEDIA_CIPHER_CHUNK_BYTES,
  MEDIA_CIPHER_MAC_BYTES,
  MEDIA_PLAINTEXT_CHUNK_BYTES,
  chunkNonce,
  createMediaId,
  deriveContentKey,
  mediaCoreName,
  mediaName,
  sniffMedia,
  validateMediaDescriptor,
  verifyPlaintext
}
