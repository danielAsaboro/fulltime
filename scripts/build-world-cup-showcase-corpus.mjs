#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { validateSeed } = require('../apps/desktop/lib/historical-room-seeder.js')

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const archiveRoot = path.resolve(repoRoot, '../resources/fixtures/world-cup-2026')
const dataRoot = path.join(repoRoot, 'data', 'world-cup-2026')
const corpusPath = path.join(dataRoot, 'showcase-corpus.json')
const reportPath = path.join(dataRoot, 'showcase-generation-report.json')
const refresh = process.argv.includes('--refresh-generated')
const HAND_AUTHORED_IDS = new Set([
  '17588227', '17926696', '17926604', '17588396', '17588308', '17588386',
  '17588316', '17926689', '17588318', '17588305', '17588239', '18209181',
  '18218149', '18213979', '18222446', '18237038', '18257865', '18257739'
])
const EXTRA_AUTHENTICATED_FIXTURES = [
  { fixtureId: '18237038', directory: '18237038-france-vs-spain' },
  { fixtureId: '18257865', directory: '18257865-france-vs-england' },
  { fixtureId: '18257739', directory: '18257739-spain-vs-argentina' }
]

const PERSONAS = [
  { id: 'fan_a', displayName: 'Amina', creator: true },
  { id: 'fan_b', displayName: 'Tunde' },
  { id: 'fan_c', displayName: 'Maya' },
  { id: 'fan_d', displayName: 'Jo' }
]

function readJson (file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function hash (bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function verifySidecars (directory, fixtureId) {
  const names = fs.readdirSync(directory).filter((name) => name.endsWith('.provenance.json')).sort()
  if (names.length === 0) {
    const manifestPath = path.join(directory, 'provenance.json')
    if (!fs.existsSync(manifestPath)) throw new Error(`${fixtureId}: no provenance sidecars or manifest`)
    const manifest = readJson(manifestPath)
    if (String(manifest.fixtureId) !== String(fixtureId)) throw new Error(`${fixtureId}: provenance manifest fixture mismatch`)
    return Object.entries(manifest.files || {}).map(([name, expected]) => {
      const targetPath = path.join(directory, name)
      if (!fs.existsSync(targetPath)) throw new Error(`${fixtureId}: provenance target missing for ${name}`)
      const bytes = fs.readFileSync(targetPath)
      const actual = hash(bytes)
      if (actual !== expected.sha256) throw new Error(`${fixtureId}: SHA-256 mismatch for ${name}`)
      if (Number.isSafeInteger(expected.bytes) && bytes.length !== expected.bytes) throw new Error(`${fixtureId}: byte length mismatch for ${name}`)
      return { file: name, sha256: actual, bytes: bytes.length }
    })
  }
  return names.map((name) => {
    const provenancePath = path.join(directory, name)
    const targetPath = provenancePath.slice(0, -'.provenance.json'.length)
    if (!fs.existsSync(targetPath)) throw new Error(`${fixtureId}: provenance target missing for ${name}`)
    const provenance = readJson(provenancePath)
    const bytes = fs.readFileSync(targetPath)
    const actual = hash(bytes)
    const expectedHash = provenance.sha256 || provenance.artifact?.sha256
    const expectedBytes = provenance.byteLength ?? provenance.artifact?.byteLength
    if (!expectedHash) throw new Error(`${fixtureId}: provenance hash missing in ${name}`)
    if (provenance.fixtureId != null && Number(provenance.fixtureId) !== Number(fixtureId)) throw new Error(`${fixtureId}: provenance fixture mismatch in ${name}`)
    if (actual !== expectedHash) throw new Error(`${fixtureId}: SHA-256 mismatch for ${path.basename(targetPath)}`)
    if (Number.isSafeInteger(expectedBytes) && bytes.length !== expectedBytes) throw new Error(`${fixtureId}: byte length mismatch for ${path.basename(targetPath)}`)
    return { file: path.basename(targetPath), sha256: actual, bytes: bytes.length }
  })
}

function readTranscript (directory) {
  const intervals = path.join(directory, 'scores.historical-intervals.json')
  if (fs.existsSync(intervals)) return readJson(intervals)
  const sse = path.join(directory, 'scores.historical.sse')
  if (!fs.existsSync(sse)) return []
  return fs.readFileSync(sse, 'utf8').split(/\r?\n/).flatMap((line) => {
    if (!line.startsWith('data: ')) return []
    try { return [JSON.parse(line.slice(6))] } catch { return [] }
  })
}

function totalScore (record) {
  const score = record?.Score || {}
  const home = Number(score.Participant1?.Total?.Goals ?? score.Participant1?.HT?.Goals ?? 0)
  const away = Number(score.Participant2?.Total?.Goals ?? score.Participant2?.HT?.Goals ?? 0)
  return { home, away }
}

function compactText (value, limit = 210) {
  const text = String(value || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[-–—: ]+|[-–—: ]+$/g, '')
    .trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1).trimEnd()}…`
}

function socialSource (post) {
  const url = post?.links?.find((entry) => /\/status\//.test(entry)) || post?.links?.[0]
  const postId = post?.postIds?.[0]
  if (!url && !postId) return null
  return {
    kind: 'x-post',
    ...(postId ? { postId: String(postId) } : {}),
    ...(url ? { url } : {}),
    ...(post?.timeUtc ? { observedAt: post.timeUtc } : {})
  }
}

function xMessage (lead, post, fallback) {
  const excerpt = compactText(post?.text || fallback, 180)
  return compactText(excerpt ? `${lead} “${excerpt}”` : fallback)
}

function scoreAtHalf (record) {
  return totalScore(record)
}

function buildSeed ({ fixture, archiveDirectory, records, analysis, social, provenance }) {
  const fixtureId = String(fixture.FixtureId)
  const home = fixture.Participant1
  const away = fixture.Participant2
  // Canonical calls are created from the signed status transition into H1,
  // not from the later provider "kickoff confirmed" incident.
  const kickoff = records.find((record) => Number(record.StatusId) === 2)
  const terminal = [...records].reverse().find((record) => record.Action === 'game_finalised')
  if (!kickoff || !Number.isSafeInteger(kickoff.Seq) || !Number.isSafeInteger(kickoff.Ts)) throw new Error(`${fixtureId}: confirmed opening kickoff missing`)
  if (!terminal || !Number.isSafeInteger(terminal.Ts)) throw new Error(`${fixtureId}: terminal game_finalised missing`)
  if (Number(terminal.FixtureId) !== Number(fixtureId)) throw new Error(`${fixtureId}: transcript fixture mismatch`)

  const final = totalScore(terminal)
  const canonicalGoals = Array.isArray(analysis?.derivedFacts?.canonicalConfirmedGoals)
    ? analysis.derivedFacts.canonicalConfirmedGoals
    : []
  const halfTime = records.find((record) => record.Action === 'halftime_finalised')
  const before = social?.phases?.before || []
  const during = social?.phases?.during || []
  const after = social?.phases?.after || []
  const createdAt = fixture.StartTime - 75 * 60_000
  const personas = PERSONAS.map((persona, index) => ({
    ...persona,
    joinedAt: createdAt + index * 60_000
  }))
  const actions = []
  const add = (action) => actions.push(action)
  const archiveSource = (record, action = record.Action) => ({
    kind: 'archive-event',
    sequence: record.Seq,
    sourceTs: record.Ts,
    action
  })

  add({
    at: fixture.StartTime - 60 * 60_000,
    actor: 'fan_a', type: 'message', key: 'amina-first-take',
    text: xMessage('This is the pre-match take doing the rounds:', before[0], `${home} look stronger on paper, but this tournament keeps punishing certainty.`),
    ...(socialSource(before[0]) ? { source: socialSource(before[0]) } : {})
  })
  add({
    at: fixture.StartTime - 59 * 60_000,
    actor: 'fan_b', type: 'reply', item: 'amina-first-take',
    text: `${home} may have the names. I still want the match to prove it before we call this routine.`
  })
  add({
    at: fixture.StartTime - 55 * 60_000,
    actor: 'fan_c', type: 'message', key: 'maya-counter-take',
    text: xMessage('Counterpoint from the timeline:', before[1], `${away} have a route into this if they survive the opening pressure.`),
    ...(socialSource(before[1]) ? { source: socialSource(before[1]) } : {})
  })
  add({ at: fixture.StartTime - 54.5 * 60_000, actor: 'fan_a', type: 'reaction', item: 'maya-counter-take', emoji: '😮' })
  add({
    at: fixture.StartTime - 53 * 60_000,
    actor: 'fan_d', type: 'quote', key: 'jo-locked-take', item: 'maya-counter-take',
    text: `I am saving this one. ${home}, ${away}, or a draw: nobody edits the story after full-time.`
  })
  add({
    at: fixture.StartTime - 45 * 60_000,
    actor: 'fan_a', type: 'poll', key: 'match-result-poll',
    question: `Who takes it: ${home} or ${away}?`,
    options: [
      { key: 'home', label: home },
      { key: 'draw', label: 'Draw' },
      { key: 'away', label: away }
    ]
  })
  add({ at: fixture.StartTime - 44.9 * 60_000, actor: 'fan_a', type: 'vote', poll: 'match-result-poll', option: 'home' })
  add({ at: fixture.StartTime - 44.8 * 60_000, actor: 'fan_b', type: 'vote', poll: 'match-result-poll', option: 'away' })
  add({ at: fixture.StartTime - 44.7 * 60_000, actor: 'fan_c', type: 'vote', poll: 'match-result-poll', option: final.home === final.away ? 'draw' : final.home > final.away ? 'home' : 'away' })
  add({ at: fixture.StartTime - 44.6 * 60_000, actor: 'fan_d', type: 'vote', poll: 'match-result-poll', option: 'draw' })

  const callId = `call:${fixtureId}:${kickoff.Seq}:phase:kickoff:opening-goal`
  add({ at: kickoff.Ts + 5_000, actor: 'fan_a', type: 'call', key: 'amina-opening-goal-yes', callId, option: 'yes', source: archiveSource(kickoff, 'kickoff') })
  add({ at: kickoff.Ts + 10_000, actor: 'fan_b', type: 'call', key: 'tunde-opening-goal-no', callId, option: 'no', source: archiveSource(kickoff, 'kickoff') })
  add({ at: kickoff.Ts + 15_000, actor: 'fan_c', type: 'call', key: 'maya-opening-goal-yes', callId, option: 'yes', source: archiveSource(kickoff, 'kickoff') })

  let homeGoals = 0
  let awayGoals = 0
  const selectedGoals = canonicalGoals.length <= 6
    ? canonicalGoals
    : [...canonicalGoals.slice(0, 4), canonicalGoals.at(-1)]
  for (const [index, goal] of selectedGoals.entries()) {
    if (goal.participant === 1) homeGoals++
    else if (goal.participant === 2) awayGoals++
    const minute = Math.max(1, Math.ceil(Number(goal.timestamp - kickoff.Ts) / 60_000))
    const key = `goal-${index + 1}`
    add({
      at: goal.timestamp + 5_000,
      actor: PERSONAS[index % PERSONAS.length].id,
      type: 'message', key,
      text: `${minute}' GOAL — ${goal.participant === 1 ? home : away}. ${homeGoals}-${awayGoals}. The room just changed sides in real time.`,
      source: {
        kind: 'archive-event', sequence: goal.sequence, sourceTs: goal.timestamp,
        action: 'goal', participant: goal.participant, goalType: goal.goalType,
        score: `${homeGoals}-${awayGoals}`
      }
    })
    add({ at: goal.timestamp + 10_000, actor: PERSONAS[(index + 1) % PERSONAS.length].id, type: 'reaction', item: key, emoji: index % 2 ? '😮' : '🔥' })
    if (index === 0) {
      add({
        at: goal.timestamp + 15_000,
        actor: 'fan_b', type: 'reply', item: key,
        text: Number(goal.timestamp - kickoff.Ts) <= 10 * 60_000
          ? 'Inside ten minutes. The opening-goal yes receipts land immediately.'
          : 'The first ten stayed quiet. Opening-goal no gets the receipt; now the match finally opens.'
      })
    }
  }

  if (halfTime) {
    const half = scoreAtHalf(halfTime)
    add({
      at: halfTime.Ts + 5_000,
      actor: 'fan_d', type: 'message', key: 'half-time-score',
      text: `Half-time: ${home} ${half.home}-${half.away} ${away}. The predictions are still sitting above us, untouched.`,
      source: { ...archiveSource(halfTime, 'halftime_finalised'), score: `${half.home}-${half.away}` }
    })
    add({ at: halfTime.Ts + 10_000, actor: 'fan_a', type: 'quote', key: 'halftime-receipt-check', item: 'jo-locked-take', text: 'Half-time receipt check. Confidence levels have moved; the words have not.' })
  }

  const duringPost = during[0]
  if (duringPost) {
    add({
      at: Math.max(kickoff.Ts + 20 * 60_000, Math.min(terminal.Ts - 60_000, halfTime?.Ts ? halfTime.Ts - 30_000 : terminal.Ts - 60_000)),
      actor: 'fan_c', type: 'message', key: 'timeline-live-reaction',
      text: xMessage('The live timeline is saying:', duringPost, 'The live reaction has completely flipped since kickoff.'),
      source: socialSource(duringPost)
    })
  }

  add({
    at: terminal.Ts + 5_000,
    actor: 'fan_a', type: 'message', key: 'full-time-result',
    text: `FULL TIME: ${home} ${final.home}-${final.away} ${away}. The score is final; the room receipts are not going anywhere.`,
    source: { ...archiveSource(terminal, 'game_finalised'), score: `${final.home}-${final.away}` }
  })
  add({ at: terminal.Ts + 10_000, actor: 'fan_b', type: 'reaction', item: 'full-time-result', emoji: final.home === final.away ? '😮' : '👏' })
  add({
    at: terminal.Ts + 20_000,
    actor: 'fan_c', type: 'quote', key: 'maya-final-receipt', item: 'maya-counter-take',
    text: `That was the take before kickoff. Final answer: ${final.home}-${final.away}. No scrollback archaeology required.`
  })
  const afterPost = after[0]
  add({
    at: terminal.Ts + 30_000,
    actor: 'fan_d', type: 'reply', item: 'full-time-result',
    text: xMessage('Post-match timeline:', afterPost, `${home} and ${away} have given everyone a fresh story to tell.`),
    ...(socialSource(afterPost) ? { source: socialSource(afterPost) } : {})
  })
  add({ at: terminal.Ts + 35_000, actor: 'fan_a', type: 'reaction', item: 'maya-final-receipt', emoji: '👏' })

  actions.sort((left, right) => left.at - right.at)
  const sourceUrls = [...before, ...during, ...after]
    .flatMap((post) => post.links || [])
    .filter((url) => /\/status\//.test(url))
    .filter((url, index, urls) => urls.indexOf(url) === index)
    .slice(0, 12)
  const archiveRelative = path.relative(repoRoot, archiveDirectory)
  const seed = {
    schemaVersion: 1,
    kind: 'fulltime.showcase.roomSeed',
    fixtureId,
    room: { name: 'World Cup sofa', createdAt },
    personas,
    actions,
    evidence: {
      fixture: `${archiveRelative}/fixture.json`,
      archive: fs.existsSync(path.join(archiveDirectory, 'scores.historical-intervals.json'))
        ? `${archiveRelative}/scores.historical-intervals.json`
        : `${archiveRelative}/scores.historical.sse`,
      provenance: fs.existsSync(path.join(archiveDirectory, 'scores.historical-intervals.json.provenance.json'))
        ? `${archiveRelative}/scores.historical-intervals.json.provenance.json`
        : `${archiveRelative}/scores.historical.sse.provenance.json`,
      socialSources: sourceUrls,
      sourcePolicy: `Authenticated TxLINE bytes are authoritative for fixture identity, kickoff, match events, phase state, and the terminal ${final.home}-${final.away} result. ${provenance.length} provenance sidecars matched their source bytes. Public X research supplies concise pre-match, live, and post-match language; the four room personas are fictional restagings and do not impersonate source authors. The opening-goal answers use the canonical call created by the production replay consumer at kickoff, so its settled receipt records genuine right and wrong calls.`
    }
  }
  return validateSeed(seed)
}

function main () {
  const index = readJson(path.join(archiveRoot, 'index.json'))
  const corpus = readJson(corpusPath)
  const existing = new Map(corpus.fixtures.map((entry) => [String(entry.fixtureId), entry]))
  const report = []

  const ordered = [...index.fixtures].sort((left, right) => Number(left.kickoff) - Number(right.kickoff))
  for (const item of ordered) {
    const fixtureId = String(item.fixtureId)
    const archiveDirectory = path.join(archiveRoot, item.directory)
    const fixture = readJson(path.join(archiveDirectory, 'fixture.json'))
    const records = readTranscript(archiveDirectory)
    const analysis = readJson(path.join(archiveDirectory, 'analysis.json'))
    const terminal = [...records].reverse().find((record) => record.Action === 'game_finalised')
    const provenance = verifySidecars(archiveDirectory, fixtureId)

    if (!terminal) {
      report.push({ fixtureId, directory: item.directory, status: 'excluded-no-terminal-capture', records: records.length, provenanceFiles: provenance.length })
      process.stdout.write(`skip ${fixtureId} ${fixture.Participant1}–${fixture.Participant2}: no terminal capture\n`)
      continue
    }

    const outputDirectory = path.join(dataRoot, item.directory)
    const seedPath = path.join(outputDirectory, 'room-seed.json')
    const wasExisting = fs.existsSync(seedPath)
    const shouldWrite = !wasExisting || (refresh && !HAND_AUTHORED_IDS.has(fixtureId))
    if (shouldWrite) {
      const socialPath = path.join(archiveDirectory, 'x-conversations.json')
      const social = fs.existsSync(socialPath) ? readJson(socialPath) : null
      const seed = buildSeed({ fixture, archiveDirectory, records, analysis, social, provenance })
      fs.mkdirSync(outputDirectory, { recursive: true })
      fs.writeFileSync(seedPath, `${JSON.stringify(seed, null, 2)}\n`)
    } else {
      validateSeed(readJson(seedPath))
    }

    const entry = existing.get(fixtureId) || {
      fixtureId,
      seed: `data/world-cup-2026/${item.directory}/room-seed.json`,
      archive: `../resources/fixtures/world-cup-2026/${item.directory}`
    }
    existing.set(fixtureId, entry)
    const seed = readJson(seedPath)
    report.push({
      fixtureId,
      directory: item.directory,
      status: shouldWrite ? 'generated' : 'preserved-existing',
      records: records.length,
      terminalSequence: terminal.Seq,
      provenanceFiles: provenance.length,
      actionCount: seed.actions.length,
      actionTypes: [...new Set(seed.actions.map((action) => action.type))].sort()
    })
    process.stdout.write(`${shouldWrite ? 'write' : 'keep'} ${fixtureId} ${fixture.Participant1}–${fixture.Participant2}: ${seed.actions.length} actions\n`)
  }

  // These authenticated late-round captures were fetched after the immutable
  // workspace index snapshot. Keep their hand-authored seeds in the same
  // chronological corpus and verify their copied raw archive bytes here.
  for (const item of EXTRA_AUTHENTICATED_FIXTURES) {
    const fixtureId = item.fixtureId
    const archiveDirectory = path.join(dataRoot, item.directory, 'archive')
    const fixture = readJson(path.join(archiveDirectory, 'fixture.json'))
    const records = readTranscript(archiveDirectory)
    const terminal = [...records].reverse().find((record) => record.Action === 'game_finalised')
    const provenance = verifySidecars(archiveDirectory, fixtureId)
    if (!terminal) throw new Error(`${fixtureId}: copied authenticated archive has no terminal record`)
    const seedPath = path.join(dataRoot, item.directory, 'room-seed.json')
    const seed = validateSeed(readJson(seedPath))
    const entry = {
      fixtureId,
      seed: `data/world-cup-2026/${item.directory}/room-seed.json`,
      archive: `data/world-cup-2026/${item.directory}/archive`
    }
    existing.set(fixtureId, entry)
    report.push({
      fixtureId,
      directory: item.directory,
      status: 'preserved-existing-late-round',
      records: records.length,
      terminalSequence: terminal.Seq,
      provenanceFiles: provenance.length,
      actionCount: seed.actions.length,
      actionTypes: [...new Set(seed.actions.map((action) => action.type))].sort()
    })
    process.stdout.write(`keep ${fixtureId} ${fixture.Participant1}–${fixture.Participant2}: ${seed.actions.length} actions\n`)
  }

  corpus.fixtures = [...existing.values()]
    .filter((entry) => report.some((row) => row.fixtureId === String(entry.fixtureId) && row.status !== 'excluded-no-terminal-capture'))
    .sort((left, right) => readJson(path.resolve(repoRoot, left.seed)).room.createdAt - readJson(path.resolve(repoRoot, right.seed)).room.createdAt)
  fs.writeFileSync(corpusPath, `${JSON.stringify(corpus, null, 2)}\n`)
  fs.writeFileSync(reportPath, `${JSON.stringify({
    schemaVersion: 1,
    kind: 'fulltime.showcase.generationReport',
    generatedAt: new Date().toISOString(),
    archiveFixtureCount: ordered.length + EXTRA_AUTHENTICATED_FIXTURES.length,
    seededFixtureCount: corpus.fixtures.length,
    excludedFixtureCount: report.filter((row) => row.status === 'excluded-no-terminal-capture').length,
    fixtures: report
  }, null, 2)}\n`)
  process.stdout.write(`done: ${corpus.fixtures.length} seeded; ${report.filter((row) => row.status === 'excluded-no-terminal-capture').length} excluded without terminal evidence\n`)
}

main()
