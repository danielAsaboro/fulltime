'use strict'

const HEADER_BYTES = 4

class FrameTooLargeError extends Error {
  constructor(size, limit) {
    super(`Peer frame is ${size} bytes; maximum is ${limit}`)
    this.name = 'FrameTooLargeError'
    this.code = 'FRAME_TOO_LARGE'
  }
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  throw new TypeError('Frame data must be binary')
}

function encodePeerFrame(value, maximumBytes) {
  const body = asBytes(value)
  if (body.byteLength > maximumBytes) throw new FrameTooLargeError(body.byteLength, maximumBytes)
  const frame = new Uint8Array(HEADER_BYTES + body.byteLength)
  const view = new DataView(frame.buffer)
  view.setUint32(0, body.byteLength, false)
  frame.set(body, HEADER_BYTES)
  return frame
}

class PeerFrameDecoder {
  constructor(maximumBytes) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new TypeError('maximumBytes must be a positive safe integer')
    }
    this.maximumBytes = maximumBytes
    this.header = new Uint8Array(HEADER_BYTES)
    this.headerOffset = 0
    this.body = null
    this.bodyOffset = 0
  }

  push(value) {
    const chunk = asBytes(value)
    const frames = []
    let offset = 0

    while (offset < chunk.byteLength) {
      if (this.body === null) {
        const available = Math.min(HEADER_BYTES - this.headerOffset, chunk.byteLength - offset)
        this.header.set(chunk.subarray(offset, offset + available), this.headerOffset)
        this.headerOffset += available
        offset += available
        if (this.headerOffset < HEADER_BYTES) continue

        const size = new DataView(this.header.buffer).getUint32(0, false)
        this.headerOffset = 0
        if (size < 1 || size > this.maximumBytes) {
          this.reset()
          throw new FrameTooLargeError(size, this.maximumBytes)
        }
        this.body = new Uint8Array(size)
        this.bodyOffset = 0
      }

      const available = Math.min(this.body.byteLength - this.bodyOffset, chunk.byteLength - offset)
      this.body.set(chunk.subarray(offset, offset + available), this.bodyOffset)
      this.bodyOffset += available
      offset += available

      if (this.bodyOffset === this.body.byteLength) {
        frames.push(this.body)
        this.body = null
        this.bodyOffset = 0
      }
    }

    return frames
  }

  reset() {
    this.headerOffset = 0
    this.body = null
    this.bodyOffset = 0
  }
}

module.exports = { FrameTooLargeError, PeerFrameDecoder, encodePeerFrame }
