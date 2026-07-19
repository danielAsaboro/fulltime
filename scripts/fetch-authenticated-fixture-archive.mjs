#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const [fixtureId, destinationArg, kickoffArg] = process.argv.slice(2)
if (!/^\d+$/.test(fixtureId || '') || !destinationArg || !/^\d+$/.test(kickoffArg || '')) {
  throw new Error('Usage: node --env-file=.env scripts/fetch-authenticated-fixture-archive.mjs <fixture-id> <destination-directory> <kickoff-ms>')
}

const origin = normalizeOrigin(process.env.TXLINE_BASE_URL || process.env.TXLINE_MAINNET_ORIGIN || 'https://txline.txodds.com')
const apiToken = process.env.TXLINE_API_TOKEN
let jwt = process.env.TXLINE_JWT
if (!apiToken) throw new Error('TXLINE_API_TOKEN is required to fetch an authenticated archive')
if (!jwt) throw new Error('TXLINE_JWT is required to fetch an authenticated archive')

const destination = path.resolve(destinationArg)
const kickoff = Number(kickoffArg)
const startEpochDay = Math.floor(kickoff / 86_400_000)
const fixtureUrl = new URL('/api/fixtures/snapshot', origin)
fixtureUrl.searchParams.set('startEpochDay', String(startEpochDay))
fixtureUrl.searchParams.set('competitionId', '72')
const scoresUrl = new URL(`/api/scores/historical/${fixtureId}`, origin)

async function authenticatedGet (url, accept) {
  let response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      'X-Api-Token': apiToken,
      Accept: accept
    },
    signal: AbortSignal.timeout(30_000)
  })
  if (response.status === 401) {
    const renewed = await fetch(new URL('/auth/guest/start', origin), {
      method: 'POST',
      signal: AbortSignal.timeout(30_000)
    })
    if (!renewed.ok) throw new Error(`TxLINE guest JWT renewal failed: HTTP ${renewed.status}`)
    const payload = await renewed.json()
    if (typeof payload.token !== 'string' || !payload.token) throw new Error('TxLINE guest JWT renewal returned no token')
    jwt = payload.token
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        'X-Api-Token': apiToken,
        Accept: accept
      },
      signal: AbortSignal.timeout(30_000)
    })
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!response.ok) {
    throw new Error(`GET ${url.pathname} failed: HTTP ${response.status} ${bytes.toString('utf8', 0, 300)}`)
  }
  return {
    bytes,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    fetchedAt: Date.now(),
    url: url.toString()
  }
}

const [fixtureResponse, scoresResponse] = await Promise.all([
  authenticatedGet(fixtureUrl, 'application/json'),
  authenticatedGet(scoresUrl, 'text/event-stream, application/json')
])

let fixtureRows
try {
  fixtureRows = JSON.parse(fixtureResponse.bytes.toString('utf8').replace(/^\uFEFF/, ''))
} catch (error) {
  throw new Error('TxLINE fixture snapshot was not valid JSON', { cause: error })
}
if (!Array.isArray(fixtureRows)) throw new Error('TxLINE fixture snapshot was not an array')
const fixture = fixtureRows.find((row) => String(row?.FixtureId) === fixtureId)
if (!fixture) throw new Error(`Fixture ${fixtureId} was absent from the authenticated snapshot`)
if (fixture.StartTime !== kickoff) throw new Error(`Fixture ${fixtureId} kickoff mismatch: expected ${kickoff}, received ${fixture.StartTime}`)

const scoreText = scoresResponse.bytes.toString('utf8').replace(/^\uFEFF/, '')
const records = parseScoreRecords(scoreText)
if (!records.length) throw new Error(`Historical scores for fixture ${fixtureId} were empty`)
if (records.some((record) => String(record?.FixtureId) !== fixtureId)) {
  throw new Error(`Historical scores for fixture ${fixtureId} contained another fixture identity`)
}
const terminal = [...records].reverse().find((record) => record.Action === 'game_finalised' || record.StatusId === 100)
if (!terminal) throw new Error(`Historical scores for fixture ${fixtureId} had no terminal record`)

await fs.mkdir(destination, { recursive: true })
await Promise.all([
  fs.writeFile(path.join(destination, 'fixtures.snapshot.raw.json'), fixtureResponse.bytes),
  fs.writeFile(path.join(destination, 'fixture.json'), `${JSON.stringify(fixture, null, 2)}\n`),
  fs.writeFile(path.join(destination, 'scores.historical.sse'), scoresResponse.bytes)
])

const fixtureBytes = Buffer.from(`${JSON.stringify(fixture, null, 2)}\n`)
const provenance = {
  schemaVersion: 1,
  kind: 'fulltime.authenticatedFixtureArchive.provenance',
  fixtureId,
  fetchedAt: new Date(Math.max(fixtureResponse.fetchedAt, scoresResponse.fetchedAt)).toISOString(),
  source: {
    origin,
    fixtureRequest: fixtureResponse.url,
    scoresRequest: scoresResponse.url,
    authentication: 'Bearer JWT plus X-Api-Token; credentials intentionally omitted'
  },
  validation: {
    fixtureIdentityMatched: true,
    kickoffMatched: true,
    scoreRecordCount: records.length,
    scoreSequenceRange: [records[0]?.Seq ?? null, records.at(-1)?.Seq ?? null],
    terminalAction: terminal.Action ?? null,
    terminalStatusId: terminal.StatusId ?? null,
    terminalTimestamp: terminal.Ts ?? null
  },
  files: {
    'fixtures.snapshot.raw.json': describeBytes(fixtureResponse.bytes, fixtureResponse.contentType),
    'fixture.json': describeBytes(fixtureBytes, 'application/json; extracted from fixtures.snapshot.raw.json'),
    'scores.historical.sse': describeBytes(scoresResponse.bytes, scoresResponse.contentType)
  }
}
await fs.writeFile(path.join(destination, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`)
console.log(JSON.stringify(provenance, null, 2))

function parseScoreRecords (text) {
  if (!text.trim()) {
    throw new Error('Historical score response was empty; the TxLINE delayed archive is not available yet')
  }
  const records = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload) continue
    try {
      records.push(JSON.parse(payload))
    } catch (error) {
      throw new Error(`Historical score SSE has invalid JSON at data line ${index + 1} (${payload.length} bytes)`, { cause: error })
    }
  }
  if (records.length) return records
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`Historical score response was neither valid SSE nor JSON (${text.length} bytes)`, { cause: error })
  }
  if (Array.isArray(value)) return value
  if (value && Array.isArray(value.records)) return value.records
  throw new Error('Historical score response was neither SSE nor a JSON record array')
}

function describeBytes (bytes, contentType) {
  return {
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    contentType
  }
}

function normalizeOrigin (value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('TXLINE_BASE_URL must be a credential-free HTTPS origin')
  }
  return url.origin
}
