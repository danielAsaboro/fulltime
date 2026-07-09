/**
 * Ingest wiring: SSE → normalize → fixture state machine → recorder.
 *
 * Every raw message is recorded verbatim (faithful corpus, dupes included); the
 * normalized snapshot is recorded only when the state machine actually advances.
 * One `FixtureMachine` per fixture keeps the seq-ordered fold isolated.
 */

import type { CorpusRecorder } from "./recorder/recorder.js";
import type { Logger } from "./logger.js";
import { FixtureMachine } from "./state/fixture-machine.js";
import type { TxlineHttp } from "./txline/http.js";
import { normalizeScore } from "./txline/scores.js";
import { parseScoresData } from "./txline/scores.js";
import { normalizeOdds, parseOddsData } from "./txline/odds.js";
import { runSseLoop } from "./txline/sse.js";
import { statusLabel } from "./txline/status.js";
import type { TxScores } from "./txline/types.js";

export interface IngestContext {
  http: TxlineHttp;
  recorder: CorpusRecorder;
  log: Logger;
  signal: AbortSignal;
  /** Optional single-fixture filter for both streams. */
  fixtureId?: string;
}

/** Fold one raw scores record into its machine and record raw + snapshot. Exported for replay/demo. */
export function ingestScore(
  tx: TxScores,
  machines: Map<string, FixtureMachine>,
  recorder: CorpusRecorder,
  log: Logger,
): void {
  const norm = normalizeScore(tx);
  const fixtureId = String(tx.fixtureId);

  recorder.recordRaw({
    kind: "raw",
    source: "scores",
    fixtureId,
    messageId: norm.messageId,
    feedTs: tx.ts,
    receivedAt: Date.now(),
    payload: tx,
  });

  let machine = machines.get(fixtureId);
  if (!machine) {
    machine = new FixtureMachine(norm.fixtureId);
    machines.set(fixtureId, machine);
  }
  const result = machine.step(norm);
  if (result.duplicate || result.outOfOrder) return;

  recorder.recordSnapshot({
    kind: "snapshot",
    fixtureId,
    feedTs: tx.ts,
    recordedAt: Date.now(),
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
}

export function startScoresIngest(ctx: IngestContext): Promise<void> {
  const machines = new Map<string, FixtureMachine>();
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
        if (tx) ingestScore(tx, machines, ctx.recorder, ctx.log);
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
        ctx.recorder.recordRaw({
          kind: "raw",
          source: "odds",
          fixtureId: String(payload.FixtureId),
          messageId: payload.MessageId,
          feedTs: payload.Ts,
          receivedAt: Date.now(),
          payload,
        });
        const snapshot = normalizeOdds(payload);
        if (snapshot) {
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
