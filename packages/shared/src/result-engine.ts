/** Pure scoring, receipt validation, leaderboard, and report derivation. */

import type { Answer } from "./answers";
import type { Call } from "./calls";
import type { FixtureId, RecordId, RoomId, UserId } from "./ids";
import type { Receipt } from "./receipts";
import { canAnchor } from "./receipts";
import type { FanReport, ScoredCallSummary, TournamentRecord } from "./records";
import {
  callPoints,
  difficultyMultiplier,
  MIN_CALLS_FOR_GLOBAL_RANK,
  type AnswerScore,
  type LeaderboardEntry,
} from "./scoring";
import type { Settlement } from "./settlements";
import type { WallClock } from "./time";

export interface ScoredArtifact {
  answer: Answer;
  call: Call;
  settlement: Settlement;
  score: AnswerScore;
  receipt: Receipt;
}

export interface FanReportInput {
  userId: UserId;
  roomId: RoomId;
  fixtureId: FixtureId;
  artifacts: readonly ScoredArtifact[];
  roomScores: readonly AnswerScore[];
  generatedAt: WallClock;
}

export type ScoreableAnswer = Pick<Answer, "id" | "callId" | "userId" | "option">;

/** Void and unscored calls intentionally return null and never affect Fan IQ. */
export function scoreAnswer(answer: Answer, call: Call, settlement: Settlement): AnswerScore | null {
  return scoreAnswerChoice(answer, call, settlement);
}

/** Score the identity and option committed by an accepted token; timing is not a scoring input. */
export function scoreAnswerChoice(
  answer: ScoreableAnswer,
  call: Call,
  settlement: Settlement,
): AnswerScore | null {
  if (answer.callId !== call.id || settlement.callId !== call.id) {
    throw new TypeError("Answer, call, and settlement IDs do not match");
  }
  if (!call.options.some((option) => option.id === answer.option)) {
    throw new TypeError("Answer option does not belong to the call");
  }
  if (!call.scored || settlement.outcome.status === "void") return null;
  const implied = call.difficulty;
  if (implied !== undefined && implied !== null &&
      (!Number.isFinite(implied) || implied <= 0 || implied > 1)) {
    throw new TypeError("Call difficulty must be a probability in (0, 1]");
  }
  const multiplier = implied == null ? 1 : difficultyMultiplier(implied);
  const correct = answer.option === settlement.outcome.winningOption;
  return {
    answerId: answer.id,
    callId: call.id,
    userId: answer.userId,
    correct,
    points: callPoints(correct, multiplier),
    multiplier,
  };
}

export function buildLeaderboard(
  scores: readonly AnswerScore[],
  displayNames: Readonly<Record<string, string>>,
): LeaderboardEntry[] {
  const byUser = new Map<string, { points: number; scored: number; correct: number }>();
  for (const score of scores) {
    const key = String(score.userId);
    const current = byUser.get(key) ?? { points: 0, scored: 0, correct: 0 };
    current.points += score.points;
    current.scored++;
    if (score.correct) current.correct++;
    byUser.set(key, current);
  }
  return [...byUser.entries()]
    .map(([userId, value]) => ({
      userId: userId as UserId,
      displayName: displayNames[userId] ?? userId,
      fanIq: value.points,
      accuracy: value.scored === 0 ? 0 : value.correct / value.scored,
      scoredCalls: value.scored,
      correctCalls: value.correct,
      globallyRanked: value.scored >= MIN_CALLS_FOR_GLOBAL_RANK,
    }))
    .sort(
      (left, right) =>
        right.fanIq - left.fanIq ||
        right.accuracy - left.accuracy ||
        String(left.userId).localeCompare(String(right.userId)),
    );
}

export function verifyReceipt(receipt: Receipt): boolean {
  if (receipt.updatedAt < receipt.createdAt) return false;
  if (receipt.state === "anchored" && !canAnchor(receipt.proof)) return false;
  if (receipt.state !== "anchored" && receipt.proof?.verifiedAt !== undefined && !canAnchor(receipt.proof)) {
    return false;
  }
  if (receipt.subject.kind === "call") {
    if (receipt.state === "void") return receipt.subject.outcome.status === "void";
    return receipt.subject.outcome.status === "settled";
  }
  return receipt.userId === undefined;
}

export function verifyScoredArtifact(artifact: ScoredArtifact): boolean {
  const expected = scoreAnswer(artifact.answer, artifact.call, artifact.settlement);
  if (!expected || !sameScore(expected, artifact.score) || !verifyReceipt(artifact.receipt)) return false;
  const receipt = artifact.receipt;
  return receipt.fixtureId === artifact.call.fixtureId &&
    receipt.userId === artifact.answer.userId &&
    receipt.subject.kind === "call" &&
    receipt.subject.callId === artifact.call.id &&
    sameOutcome(receipt.subject.outcome, artifact.settlement.outcome);
}

export function buildFanReport(input: FanReportInput): FanReport {
  const artifacts = input.artifacts.filter(
    (artifact) => artifact.answer.userId === input.userId && verifyScoredArtifact(artifact),
  );
  const ownScores = artifacts.map((artifact) => artifact.score);
  const fanIq = ownScores.reduce((total, score) => total + score.points, 0);
  const correct = ownScores.filter((score) => score.correct).length;
  const users = uniqueUsers(input.roomScores, input.userId);
  const totals = users
    .map((userId) => ({
      userId,
      points: input.roomScores
        .filter((score) => score.userId === userId)
        .reduce((sum, score) => sum + score.points, 0),
      accuracy: accuracyFor(input.roomScores.filter((score) => score.userId === userId)),
    }))
    .sort(
      (left, right) =>
        right.points - left.points ||
        right.accuracy - left.accuracy ||
        String(left.userId).localeCompare(String(right.userId)),
    );
  const rankIndex = totals.findIndex((entry) => entry.userId === input.userId);
  const rank = rankIndex < 0 ? totals.length + 1 : rankIndex + 1;
  const percentile = totals.length <= 1
    ? 100
    : Math.round(((totals.length - rank) / (totals.length - 1)) * 100);
  const correctArtifacts = artifacts.filter((artifact) => artifact.score.correct);
  const misses = artifacts.filter((artifact) => !artifact.score.correct);

  return {
    userId: input.userId,
    roomId: input.roomId,
    fixtureId: input.fixtureId,
    fanIq,
    accuracy: ownScores.length === 0 ? 0 : correct / ownScores.length,
    rank,
    percentile,
    scoredCalls: ownScores.length,
    bestRead: maybeSummary(maxBy(correctArtifacts, (artifact) => artifact.score.points)),
    highestDifficultyHit: maybeSummary(maxBy(correctArtifacts, (artifact) => artifact.score.multiplier)),
    biggestMiss: maybeSummary(maxBy(misses, (artifact) => potentialPoints(artifact.call))),
    generatedAt: input.generatedAt,
  };
}

export function buildTournamentRecord(
  id: RecordId,
  userId: UserId,
  artifacts: readonly ScoredArtifact[],
  updatedAt: WallClock,
): TournamentRecord {
  const valid = artifacts.filter(
    (artifact) => artifact.answer.userId === userId && verifyScoredArtifact(artifact),
  );
  const summaries = valid.map(summaryFor);
  const fixtures = new Set(valid.map((artifact) => String(artifact.call.fixtureId)));
  const correct = valid.filter((artifact) => artifact.score.correct).length;
  return {
    id,
    userId,
    fanIq: valid.reduce((total, artifact) => total + artifact.score.points, 0),
    accuracy: valid.length === 0 ? 0 : correct / valid.length,
    matchesPlayed: fixtures.size,
    calls: summaries,
    updatedAt,
  };
}

function summaryFor(artifact: ScoredArtifact): ScoredCallSummary {
  return {
    callId: artifact.call.id,
    fixtureId: artifact.call.fixtureId,
    prompt: artifact.call.prompt,
    chosenOption: artifact.answer.option,
    correct: artifact.score.correct,
    points: artifact.score.points,
    receiptState: artifact.receipt.state,
  };
}

function maybeSummary(artifact: ScoredArtifact | undefined): ScoredCallSummary | undefined {
  return artifact ? summaryFor(artifact) : undefined;
}

function potentialPoints(call: Call): number {
  const multiplier = call.difficulty == null ? 1 : difficultyMultiplier(call.difficulty);
  return callPoints(true, multiplier);
}

function maxBy<T>(items: readonly T[], value: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const candidate = value(item);
    if (candidate > bestValue) {
      best = item;
      bestValue = candidate;
    }
  }
  return best;
}

function uniqueUsers(scores: readonly AnswerScore[], include: UserId): UserId[] {
  const users = new Map<string, UserId>([[String(include), include]]);
  for (const score of scores) users.set(String(score.userId), score.userId);
  return [...users.values()];
}

function accuracyFor(scores: readonly AnswerScore[]): number {
  return scores.length === 0 ? 0 : scores.filter((score) => score.correct).length / scores.length;
}

function sameScore(left: AnswerScore, right: AnswerScore): boolean {
  return left.answerId === right.answerId && left.callId === right.callId && left.userId === right.userId &&
    left.correct === right.correct && left.points === right.points && left.multiplier === right.multiplier;
}

function sameOutcome(left: Settlement["outcome"], right: Settlement["outcome"]): boolean {
  if (left.status !== right.status) return false;
  return left.status === "settled"
    ? right.status === "settled" && left.winningOption === right.winningOption
    : right.status === "void" && left.reason === right.reason;
}
