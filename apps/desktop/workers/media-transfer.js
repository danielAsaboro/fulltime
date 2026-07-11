'use strict'

const b4a = require('b4a')
const crypto = require('hypercore-crypto')

const { MAX_FILE_BYTES } = require('../lib/encrypted-media.js')

const MAX_MEDIA_TRANSFER_CHUNK_BYTES = 256 * 1024
const MAX_ACTIVE_UPLOADS = 2
const MAX_ACTIVE_DOWNLOADS = 2
const MEDIA_TRANSFER_IDLE_MS = 60_000
const ROOM_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,179}$/
const TRANSFER_ID = /^(?:upload|download)_[a-f0-9]{32}$/

/**
 * Keeps renderer bytes out of durable room operations. Uploads are bounded and
 * discarded after authenticated import; downloads hold only verified plaintext
 * until the renderer has consumed it in small IPC frames.
 */
class MediaTransferManager {
  constructor ({ getRoom }) {
    if (typeof getRoom !== 'function') throw new TypeError('Media transfer room resolver is required')
    this.getRoom = getRoom
    this.uploads = new Map()
    this.downloads = new Map()
    this.closed = false
  }

  beginUpload ({ roomId, name, sizeBytes }) {
    this._assertOpen()
    assertRoomId(roomId)
    assertMediaName(name)
    assertSize(sizeBytes)
    if (this.uploads.size >= MAX_ACTIVE_UPLOADS) throw new Error('Too many media imports are already in progress')
    const upload = {
      id: transferId('upload'),
      roomId,
      name,
      sizeBytes,
      receivedBytes: 0,
      chunks: [],
      nextIndex: 0,
      committing: false,
      timer: null
    }
    this.uploads.set(upload.id, upload)
    this._arm(upload, () => this._disposeUpload(upload))
    return {
      uploadId: upload.id,
      chunkBytes: MAX_MEDIA_TRANSFER_CHUNK_BYTES
    }
  }

  appendUpload ({ roomId, uploadId, index, data }) {
    this._assertOpen()
    assertRoomId(roomId)
    const upload = this._upload(uploadId, roomId)
    if (upload.committing) throw new Error('Media import is already being committed')
    if (!Number.isSafeInteger(index) || index < 0) throw new TypeError('Media chunk index is invalid')
    const bytes = decodeChunk(data)
    if (bytes.byteLength > MAX_MEDIA_TRANSFER_CHUNK_BYTES) throw new TypeError('Media chunk exceeds the IPC limit')
    if (index < upload.nextIndex) {
      const previous = upload.chunks[index]
      if (!previous || !b4a.equals(previous, bytes)) throw new Error('Media chunk retry does not match the original bytes')
      bytes.fill(0)
      this._arm(upload, () => this._disposeUpload(upload))
      return { receivedBytes: upload.receivedBytes, nextIndex: upload.nextIndex }
    }
    if (index !== upload.nextIndex) {
      bytes.fill(0)
      throw new Error('Media chunks must arrive in order')
    }
    if (upload.receivedBytes + bytes.byteLength > upload.sizeBytes) {
      bytes.fill(0)
      throw new Error('Media bytes exceed the declared file size')
    }
    upload.chunks.push(bytes)
    upload.receivedBytes += bytes.byteLength
    upload.nextIndex++
    this._arm(upload, () => this._disposeUpload(upload))
    return { receivedBytes: upload.receivedBytes, nextIndex: upload.nextIndex }
  }

  async commitUpload ({ roomId, uploadId, text }) {
    this._assertOpen()
    assertRoomId(roomId)
    if (typeof text !== 'string' || text.length > 1000) throw new TypeError('Attachment message text is invalid')
    const upload = this._upload(uploadId, roomId)
    if (upload.committing) throw new Error('Media import is already being committed')
    if (upload.receivedBytes !== upload.sizeBytes) throw new Error('Media bytes do not match the declared file size')
    upload.committing = true
    clearTimeout(upload.timer)
    try {
      const room = this.getRoom(roomId)
      return await room.sendMediaMessage({ name: upload.name, source: upload.chunks, text })
    } finally {
      this._disposeUpload(upload)
    }
  }

  abortUpload ({ roomId, uploadId }) {
    assertRoomId(roomId)
    const upload = this._upload(uploadId, roomId)
    if (upload.committing) throw new Error('Media import is already being committed')
    this._disposeUpload(upload)
    return null
  }

  async beginDownload ({ roomId, itemId }) {
    this._assertOpen()
    assertRoomId(roomId)
    if (typeof itemId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,179}$/.test(itemId)) {
      throw new TypeError('Media item ID is invalid')
    }
    if (this.downloads.size >= MAX_ACTIVE_DOWNLOADS) throw new Error('Too many media downloads are already in progress')
    const room = this.getRoom(roomId)
    const { attachment, bytes } = await room.readMedia(itemId)
    if (!b4a.isBuffer(bytes) || bytes.byteLength !== attachment.sizeBytes) {
      if (bytes?.fill) bytes.fill(0)
      throw new Error('Verified media download has an invalid byte length')
    }
    const download = {
      id: transferId('download'),
      roomId,
      itemId,
      attachment,
      bytes,
      nextIndex: 0,
      lastIndex: null,
      timer: null
    }
    this.downloads.set(download.id, download)
    this._arm(download, () => this._disposeDownload(download))
    return {
      downloadId: download.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      chunkBytes: MAX_MEDIA_TRANSFER_CHUNK_BYTES,
      chunks: Math.ceil(bytes.byteLength / MAX_MEDIA_TRANSFER_CHUNK_BYTES)
    }
  }

  readDownloadChunk ({ roomId, downloadId, index }) {
    this._assertOpen()
    assertRoomId(roomId)
    const download = this._download(downloadId, roomId)
    if (!Number.isSafeInteger(index) || index < 0) throw new TypeError('Media chunk index is invalid')
    if (index !== download.nextIndex && index !== download.lastIndex) {
      throw new Error('Media chunks must be read in order')
    }
    const offset = index * MAX_MEDIA_TRANSFER_CHUNK_BYTES
    if (offset >= download.bytes.byteLength) throw new Error('Media chunk is out of range')
    const end = Math.min(download.bytes.byteLength, offset + MAX_MEDIA_TRANSFER_CHUNK_BYTES)
    const data = b4a.toString(download.bytes.subarray(offset, end), 'base64url')
    const hasMore = end < download.bytes.byteLength
    if (index === download.nextIndex) {
      download.lastIndex = index
      download.nextIndex++
    }
    if (hasMore) this._arm(download, () => this._disposeDownload(download))
    else this._disposeDownload(download)
    return { index, data, hasMore }
  }

  closeDownload ({ roomId, downloadId }) {
    assertRoomId(roomId)
    this._disposeDownload(this._download(downloadId, roomId))
    return null
  }

  close () {
    if (this.closed) return
    this.closed = true
    for (const upload of [...this.uploads.values()]) this._disposeUpload(upload)
    for (const download of [...this.downloads.values()]) this._disposeDownload(download)
  }

  _upload (uploadId, roomId) {
    if (typeof uploadId !== 'string' || !TRANSFER_ID.test(uploadId) || !uploadId.startsWith('upload_')) {
      throw new TypeError('Media upload ID is invalid')
    }
    const upload = this.uploads.get(uploadId)
    if (!upload || upload.roomId !== roomId) throw new Error('Media upload is unavailable or expired')
    return upload
  }

  _download (downloadId, roomId) {
    if (typeof downloadId !== 'string' || !TRANSFER_ID.test(downloadId) || !downloadId.startsWith('download_')) {
      throw new TypeError('Media download ID is invalid')
    }
    const download = this.downloads.get(downloadId)
    if (!download || download.roomId !== roomId) throw new Error('Media download is unavailable or expired')
    return download
  }

  _arm(session, dispose) {
    clearTimeout(session.timer)
    session.timer = setTimeout(dispose, MEDIA_TRANSFER_IDLE_MS)
  }

  _disposeUpload(upload) {
    if (!upload || !this.uploads.delete(upload.id)) return
    clearTimeout(upload.timer)
    for (const chunk of upload.chunks) chunk.fill(0)
    upload.chunks.length = 0
    upload.receivedBytes = 0
  }

  _disposeDownload(download) {
    if (!download || !this.downloads.delete(download.id)) return
    clearTimeout(download.timer)
    download.bytes.fill(0)
  }

  _assertOpen () {
    if (this.closed) throw new Error('Media transfer manager is closed')
  }
}

function transferId (prefix) {
  return `${prefix}_${b4a.toString(crypto.randomBytes(16), 'hex')}`
}

function assertRoomId (value) {
  if (typeof value !== 'string' || !ROOM_ID.test(value)) throw new TypeError('Room ID is invalid')
}

function assertMediaName (value) {
  if (typeof value !== 'string' || !value || value.length > 255) throw new TypeError('Media name is invalid')
}

function assertSize (value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_FILE_BYTES) {
    throw new TypeError(`Media size must be between 1 and ${MAX_FILE_BYTES} bytes`)
  }
}

function decodeChunk (value) {
  if (typeof value !== 'string' || value.length < 1 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError('Media chunk is not canonical base64url')
  }
  const bytes = b4a.from(value, 'base64url')
  if (bytes.byteLength < 1 || b4a.toString(bytes, 'base64url') !== value) {
    bytes.fill(0)
    throw new TypeError('Media chunk is not canonical base64url')
  }
  return bytes
}

module.exports = {
  MAX_ACTIVE_DOWNLOADS,
  MAX_ACTIVE_UPLOADS,
  MAX_MEDIA_TRANSFER_CHUNK_BYTES,
  MEDIA_TRANSFER_IDLE_MS,
  MediaTransferManager
}
