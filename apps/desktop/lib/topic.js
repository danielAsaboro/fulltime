'use strict'

const crypto = require('crypto')
const { normalizeRoomCode } = require('./config.js')

const DEVELOPMENT_TOPIC_PREFIX = 'fulltime:development-transport-smoke:v1:'

function deriveDevelopmentTopic(roomCode) {
  return crypto
    .createHash('sha256')
    .update(DEVELOPMENT_TOPIC_PREFIX + normalizeRoomCode(roomCode), 'utf8')
    .digest('hex')
}

module.exports = { DEVELOPMENT_TOPIC_PREFIX, deriveDevelopmentTopic }
