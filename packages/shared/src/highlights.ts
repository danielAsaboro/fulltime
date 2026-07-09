/**
 * Swarm Highlights — shareable summaries from combined room activity plus TxLINE
 * facts. Deterministic templates first; any optional LLM is post-event only and
 * may only summarize already-verified inputs, never invent facts. `sourceIds`
 * pins every input the highlight was built from (PRD §4.9).
 */

import type { FixtureId, HighlightId, RoomId } from "./ids.js";
import type { WallClock } from "./time.js";

export type HighlightKind =
  | "half-time-pulse"
  | "full-time-memory"
  | "best-call"
  | "biggest-swing"
  | "room-knew"
  | "room-cooked";

export interface Highlight {
  id: HighlightId;
  roomId: RoomId;
  fixtureId: FixtureId;
  kind: HighlightKind;
  title: string;
  body: string;
  /** IDs of the verified inputs this highlight was built from. */
  sourceIds: string[];
  createdAt: WallClock;
}
