'use strict'

// Keep this Bare-safe mirror of packages/shared/src/match-intelligence.ts free
// of Node or renderer dependencies. It consumes only publisher-validated JSON.

const OUTCOMES = ['home', 'draw', 'away']
const MARKET_MOVE_THRESHOLD = 0.025
const MARKET_SWING_THRESHOLD = 0.06
const RECENT_EVENT_LIMIT = 8
const RECENT_ODDS_TRANSITIONS = 6

const EVENT_WEIGHT = Object.freeze({
  kickoff: 0.04,
  goal: 0.68,
  'own-goal': 0.68,
  'penalty-scored': 0.68,
  'penalty-missed': 0.52,
  'yellow-card': 0.16,
  'second-yellow': 0.36,
  'red-card': 0.44,
  substitution: 0.08,
  corner: 0.12,
  'shot-on-target': 0.24,
  'shot-off-target': 0.12,
  save: 0.18,
  var: 0.22,
  offside: 0.08,
  foul: 0.06,
  'half-time': 0.02,
  'second-half-start': 0.04,
  'end-of-regulation': 0.02,
  'extra-time-start': 0.08,
  'penalty-shootout-start': 0.16,
  'full-time': 0,
  abandoned: 0
})

function projectMarketSays (fixtureId, odds, events) {
  const orderedOdds = sortOdds(fixtureId, odds)
  const orderedEvents = sortEvents(fixtureId, events)
  const cards = []
  for (let index = 1; index < orderedOdds.length; index++) {
    const from = orderedOdds[index - 1]
    const to = orderedOdds[index]
    const fromImplied = impliedFromDecimal(from.decimal)
    const toImplied = impliedFromDecimal(to.decimal)
    if (!fromImplied || !toImplied) continue
    const move = largestMove(fromImplied, toImplied)
    if (Math.abs(move.delta) < MARKET_MOVE_THRESHOLD) continue
    const preceding = latestEventBetween(orderedEvents, from.feedTs, to.feedTs)
    const kind = marketKind(move.outcome, move.delta, preceding, Math.abs(move.delta))
    cards.push({
      id: `market:${fixtureId}:${to.messageId}`,
      fixtureId,
      kind,
      feedTs: to.feedTs,
      text: marketText(kind, move.outcome, move.delta, preceding),
      evidence: {
        fromImplied: probabilities(fromImplied),
        toImplied: probabilities(toImplied),
        ...(preceding ? { precedingEventId: preceding.id } : {})
      }
    })
  }
  return cards
}

function projectPressure (fixtureId, events, odds) {
  const orderedEvents = sortEvents(fixtureId, events)
  const orderedOdds = sortOdds(fixtureId, odds)
  const newestEvents = orderedEvents.slice(-RECENT_EVENT_LIMIT).reverse()
  const eventContribution = clamp01(newestEvents.reduce((total, event, index) => {
    return total + (EVENT_WEIGHT[event.kind] || 0) * Math.pow(0.72, index)
  }, 0) / 1.2)
  let oddsImpulse = 0
  const transitions = orderedOdds.slice(-(RECENT_ODDS_TRANSITIONS + 1))
  for (let index = 1; index < transitions.length; index++) {
    const before = impliedFromDecimal(transitions[index - 1].decimal)
    const after = impliedFromDecimal(transitions[index].decimal)
    if (!before || !after) continue
    oddsImpulse += Math.abs(largestMove(before, after).delta)
  }
  const oddsContribution = clamp01(oddsImpulse / 0.18)
  const latestEvent = orderedEvents.length ? orderedEvents[orderedEvents.length - 1].feedTs : null
  const latestOdds = orderedOdds.length ? orderedOdds[orderedOdds.length - 1].feedTs : null
  return {
    fixtureId,
    value: clamp01(eventContribution * 0.7 + oddsContribution * 0.3),
    eventContribution,
    oddsContribution,
    eventCount: orderedEvents.length,
    oddsSnapshotCount: orderedOdds.length,
    feedTs: maxFeedTs(latestEvent, latestOdds)
  }
}

function impliedFromDecimal (decimal) {
  if (!decimal || typeof decimal !== 'object') return null
  const raw = {}
  let total = 0
  for (const outcome of OUTCOMES) {
    const value = decimal[outcome]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
    raw[outcome] = 1 / value
    total += raw[outcome]
  }
  if (!Number.isFinite(total) || total <= 0) return null
  return {
    home: raw.home / total,
    draw: raw.draw / total,
    away: raw.away / total
  }
}

function sortEvents (fixtureId, events) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event && event.fixtureId === fixtureId)
    .slice()
    .sort((left, right) => left.feedTs - right.feedTs || String(left.id).localeCompare(String(right.id)))
}

function sortOdds (fixtureId, odds) {
  return (Array.isArray(odds) ? odds : [])
    .filter((snapshot) => snapshot && snapshot.fixtureId === fixtureId)
    .slice()
    .sort((left, right) => left.feedTs - right.feedTs || String(left.messageId).localeCompare(String(right.messageId)))
}

function probabilities (value) {
  return { home: value.home, draw: value.draw, away: value.away }
}

function largestMove (from, to) {
  let outcome = 'home'
  let delta = to.home - from.home
  for (const candidateOutcome of OUTCOMES.slice(1)) {
    const candidate = to[candidateOutcome] - from[candidateOutcome]
    if (Math.abs(candidate) > Math.abs(delta) ||
      (Math.abs(candidate) === Math.abs(delta) && candidateOutcome.localeCompare(outcome) < 0)) {
      outcome = candidateOutcome
      delta = candidate
    }
  }
  return { outcome, delta }
}

function latestEventBetween (events, after, until) {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event.feedTs > until) continue
    if (event.feedTs > after) return event
    return null
  }
  return null
}

function marketKind (outcome, delta, preceding, magnitude) {
  if (outcome === 'draw' && delta > 0) return 'draw-compressing'
  if (preceding && goalLike(preceding.kind) && delta < 0) return 'not-buying-panic'
  if (preceding && pressureEvent(preceding.kind) && delta > 0) return 'pressure-building'
  if (magnitude >= MARKET_SWING_THRESHOLD) return 'swing'
  return 'muted-reaction'
}

function marketText (kind, outcome, delta, preceding) {
  const side = outcome === 'home' ? 'the home side' : outcome === 'away' ? 'the away side' : 'a draw'
  const event = preceding ? eventLabel(preceding.kind) : null
  switch (kind) {
    case 'pressure-building':
      return event ? `After the ${event}, the market moved toward ${side}.` : `The market moved toward ${side}.`
    case 'not-buying-panic':
      return event ? `After the ${event}, the market moved away from ${side}.` : `The market moved away from ${side}.`
    case 'draw-compressing':
      return 'The market has tightened around a draw.'
    case 'swing':
      return `A sharp market swing moved ${delta > 0 ? 'toward' : 'away from'} ${side}.`
    default:
      return event ? `The market made a measured move after the ${event}.` : 'The market made a measured move.'
  }
}

function goalLike (kind) {
  return kind === 'goal' || kind === 'own-goal' || kind === 'penalty-scored' || kind === 'penalty-missed'
}

function pressureEvent (kind) {
  return goalLike(kind) || kind === 'shot-on-target' || kind === 'corner' || kind === 'red-card' || kind === 'second-yellow'
}

function eventLabel (kind) {
  return String(kind).replace(/-/g, ' ')
}

function clamp01 (value) {
  return Math.max(0, Math.min(1, value))
}

function maxFeedTs (left, right) {
  if (left === null) return right
  if (right === null) return left
  return left >= right ? left : right
}

module.exports = { impliedFromDecimal, projectMarketSays, projectPressure }
