/**
 * MatchSync calibration persisted per viewer per room. Drives the client release
 * queue; the calibration method is retained so global-leaderboard scoring can
 * deweight implausible delay claims (PRD §4.2 integrity policy). Presentation
 * only — never an input to settlement.
 */

import type { RoomId, UserId } from "./ids";
import type { DelaySeconds, StreamDelayProfile, WallClock } from "./time";

export type CalibrationMethod =
  | "preset"
  | "kickoff-tap"
  | "event-tap"
  | "manual-minute"
  | "recalibrate";

export interface MatchSyncProfile {
  userId: UserId;
  roomId: RoomId;
  delaySeconds: DelaySeconds;
  /** The preset chosen at calibration, when the viewer picked one. */
  profile?: StreamDelayProfile;
  method: CalibrationMethod;
  calibratedAt: WallClock;
}
