/**
 * Ingest wiring: SSE → normalize → fixture state machine → recorder.
 *
 * Every raw message is recorded verbatim (faithful corpus, dupes included); the
 * normalized snapshot is recorded only when the state machine actually advances.
 * One `FixtureMachine` per fixture keeps the seq-ordered fold isolated.
 */

import type { FixtureState, MatchEvent, PublishedScoreUpdate } from "@fulltime/shared";

import type { Logger } from "./logger.js";
import type { FixturePlanePublisher } from "./publisher/fixture-publisher.js";
import type { CorpusRecorder } from "./recorder/recorder.js";
import { FixtureMachine } from "./state/fixture-machine.js";
import type { TxlineHttp } from "./txline/http.js";
import { normalizeScore, parseScoresData, type NormalizedScore } from "./txline/scores.js";
import { normalizeOdds, parseOddsData } from "./txline/odds.js";
import { runSseLoop } from "./txline/sse.js";
import { statusLabel } from "./txline/status.js";
import type { TxScores } from "./txline/types.js";

export interface IngestContext {
  http: TxlineHttp;
  recorder: CorpusRecorder;
  log: Logger;
  signal: AbortSignal;
  publisher: FixturePlanePublisher;
  /** A signed-log failure is fatal: continuing would create an incomplete public history. */
  onPublisherError(error: unknown): void;
  /** Optional single-fixture filter for both streams. */
  fixtureId?: string;
}

export interface IngestedScore {
  update: PublishedScoreUpdate;
  state: FixtureState;
  events: MatchEvent[];
  receivedAt: number;
}

/** Fold one raw scores record into its machine and record raw + snapshot. Exported for recovery tests. */
export function ingestScore(
  tx: TxScores,
  machines: Map<string, FixtureMachine>,
  recorder: CorpusRecorder,
  log: Logger,
): IngestedScore | null {
  const norm = normalizeScore(tx);
  const fixtureId = String(tx.fixtureId);
  const receivedAt = Date.now();

  recorder.recordRaw({
    kind: "raw",
    source: "scores",
    fixtureId,
    messageId: norm.messageId,
    feedTs: tx.ts,
    receivedAt,
    payload: tx,
  });

  let machine = machines.get(fixtureId);
  if (!machine) {
    machine = new FixtureMachine(norm.fixtureId);
    machines.set(fixtureId, machine);
  }
  const result = machine.step(norm);
  if (result.duplicate || result.outOfOrder) return null;

  recorder.recordSnapshot({
    kind: "snapshot",
    fixtureId,
    feedTs: tx.ts,
    recordedAt: receivedAt,
    snapshot: result.state,
  });

  if (result.gap) log.warn("feed gap detected", { fixtureId, seq: norm.seq });
  for (const event of result.events) {
    log.info("event", {
      fixtureId,
      kind: event.kind,
      minute: event.minute,
      score: `${result.state.score.home}-${result.state.score.away}`,
      status: statusLabel(norm.statusCode),
    });
  }
  return {
    update: publishedScore(norm),
    state: result.state,
    events: result.events,
    receivedAt,
  };
}

function publishedScore(score: NormalizedScore): PublishedScoreUpdate {
  return {
    fixtureId: score.fixtureId,
    feedTs: score.feedTs,
    messageId: score.messageId,
    seq: score.seq,
    statusCode: score.statusCode,
    status: score.status,
    minute: score.minute,
    score: score.score,
    hasScore: score.hasScore,
  };
}

function publish(ctx: IngestContext, operation: Promise<unknown>): void {
  void operation.catch((error: unknown) => ctx.onPublisherError(error));
}

export function startScoresIngest(ctx: IngestContext): Promise<void> {
  const machines = new Map(
    ctx.publisher.scoreCheckpoints().map((record) => [
      String(record.update.fixtureId),
      new FixtureMachine(record.update.fixtureId, {
        state: record.state,
        lastSeq: record.update.seq,
        lastStatusCode: record.update.statusCode,
      }),
    ]),
  );
  return runSseLoop({
    http: ctx.http,
    path: "/api/scores/stream",
    query: ctx.fixtureId ? { fixtureId: ctx.fixtureId } : undefined,
    log: ctx.log,
    signal: ctx.signal,
    handlers: {
      onOpen: () => ctx.log.info("scores stream open"),
      onGap: (reason) => ctx.log.warn("scores stream gap", { reason }),
      onEvent: (event) => {
        const tx = parseScoresData(event.data);
        if (!tx) return;
        const ingested = ingestScore(tx, machines, ctx.recorder, ctx.log);
        if (ingested) {
          publish(
            ctx,
            ctx.publisher.publishScore(
              ingested.update,
              ingested.state,
              ingested.events,
              ingested.receivedAt,
            ),
          );
        }
      },
    },
  });
}

export function startOddsIngest(ctx: IngestContext): Promise<void> {
  return runSseLoop({
    http: ctx.http,
    path: "/api/odds/stream",
    query: ctx.fixtureId ? { fixtureId: ctx.fixtureId } : undefined,
    log: ctx.log,
    signal: ctx.signal,
    handlers: {
      onOpen: () => ctx.log.info("odds stream open"),
      onGap: (reason) => ctx.log.warn("odds stream gap", { reason }),
      onEvent: (event) => {
        const payload = parseOddsData(event.data);
        if (!payload) return;
        const receivedAt = Date.now();
        ctx.recorder.recordRaw({
          kind: "raw",
          source: "odds",
          fixtureId: String(payload.FixtureId),
          messageId: payload.MessageId,
          feedTs: payload.Ts,
          receivedAt,
          payload,
        });
        const snapshot = normalizeOdds(payload);
        if (snapshot) {
          publish(ctx, ctx.publisher.publishOdds(snapshot, receivedAt));
          ctx.log.debug("odds", {
            fixtureId: String(payload.FixtureId),
            home: snapshot.decimal.home.toFixed(2),
            draw: snapshot.decimal.draw.toFixed(2),
            away: snapshot.decimal.away.toFixed(2),
          });
        }
      },
    },
  });
}
