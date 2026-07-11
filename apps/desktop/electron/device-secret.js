'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const DEVICE_SECRET_BYTES = 32
const DEVICE_SECRET_FILENAME = 'device-secret.safe-storage'

function loadOrCreateDeviceSecret (safeStorage, directory) {
  assertSafeStorage(safeStorage)
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\u0000')) {
    throw new TypeError('Device-secret directory must be an absolute path')
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const filename = path.join(directory, DEVICE_SECRET_FILENAME)
  if (fs.existsSync(filename)) return readDeviceSecret(safeStorage, filename)

  const secret = crypto.randomBytes(DEVICE_SECRET_BYTES)
  const encrypted = safeStorage.encryptString(secret.toString('hex'))
  if (!Buffer.isBuffer(encrypted) || encrypted.byteLength < 1) {
    secret.fill(0)
    throw new Error('Operating-system safe storage did not encrypt the device secret')
  }
  try {
    fs.writeFileSync(filename, encrypted, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      secret.fill(0)
      throw error
    }
    secret.fill(0)
    return readDeviceSecret(safeStorage, filename)
  }
  fs.chmodSync(filename, 0o600)
  return secret
}

function readDeviceSecret (safeStorage, filename) {
  const stat = fs.statSync(filename)
  if (!stat.isFile() || stat.size < 1 || stat.size > 64 * 1024) {
    throw new Error('The operating-system-protected device secret file is invalid')
  }
  const decrypted = safeStorage.decryptString(fs.readFileSync(filename))
  if (typeof decrypted !== 'string' || !/^[a-f0-9]{64}$/.test(decrypted)) {
    throw new Error('The operating-system-protected device secret could not be decoded')
  }
  return Buffer.from(decrypted, 'hex')
}

function assertSafeStorage (safeStorage) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' ||
      typeof safeStorage.encryptString !== 'function' || typeof safeStorage.decryptString !== 'function') {
    throw new TypeError('Electron safeStorage is unavailable')
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Operating-system credential encryption is unavailable; FullTime will not store an identity seed in plaintext')
  }
  if (typeof safeStorage.getSelectedStorageBackend === 'function' &&
      safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error('Electron selected the insecure basic_text storage backend; configure an OS credential store before using FullTime')
  }
}

module.exports = {
  DEVICE_SECRET_BYTES,
  DEVICE_SECRET_FILENAME,
  loadOrCreateDeviceSecret
}
