/**
 * Time model — the spine of MatchSync and of settlement correctness.
 *
 * Two clocks, kept deliberately distinct at the type level:
 *
 *  - `FeedTimestamp`  authoritative time as reported by TxLINE. Settlement,
 *                     ordering, and receipts are decided in feed time. Never a
 *                     function of any user's stream delay.
 *  - `WallClock`      real time on a machine (server receipt time, client now).
 *                     Used for presentation scheduling and anti-cheat heuristics.
 *
 * MatchSync releases each room item to a viewer at `feed_ts + D`, where `D` is
 * that viewer's presentation delay. Presentation only — it can never move truth.
 */

import type { Brand } from "./ids";

export type FeedTimestamp = Brand<number, "FeedTimestamp">;
export type WallClock = Brand<number, "WallClock">;

/** A viewer's presentation delay `D`, in seconds. */
export type DelaySeconds = number;

export const asFeedTimestamp = (msEpoch: number): FeedTimestamp => msEpoch as FeedTimestamp;
export const asWallClock = (msEpoch: number): WallClock => msEpoch as WallClock;

export const nowWallClock = (): WallClock => Date.now() as WallClock;

/**
 * Stream-delay presets offered at calibration. Values are seconds and are
 * intentionally coarse; a viewer fine-tunes with tap-to-calibrate. Provisional
 * until measured against real broadcast paths.
 */
export const STREAM_DELAY_PRESETS = {
  stadium: 3,
  liveTv: 8,
  cable: 25,
  appStream: 42,
} as const satisfies Record<string, DelaySeconds>;

export type StreamDelayProfile = keyof typeof STREAM_DELAY_PRESETS;

export const MIN_DELAY_SECONDS = 0;
export const MAX_DELAY_SECONDS = 180;

export function clampDelaySeconds(seconds: number): DelaySeconds {
  if (!Number.isFinite(seconds)) return 0;
  return Math.min(MAX_DELAY_SECONDS, Math.max(MIN_DELAY_SECONDS, seconds));
}

/** Wall-clock instant at which an item stamped `feedTs` should surface to a viewer with delay `D`. */
export function releaseAt(feedTs: FeedTimestamp, delaySeconds: DelaySeconds): WallClock {
  return (feedTs + clampDelaySeconds(delaySeconds) * 1000) as WallClock;
}

/** Milliseconds a viewer must still wait before an item is allowed to surface (never negative). */
export function msUntilRelease(
  feedTs: FeedTimestamp,
  delaySeconds: DelaySeconds,
  now: WallClock = nowWallClock(),
): number {
  return Math.max(0, releaseAt(feedTs, delaySeconds) - now);
}

/** Whether an item stamped `feedTs` is cleared to surface to a viewer with delay `D` at `now`. */
export function isReleased(
  feedTs: FeedTimestamp,
  delaySeconds: DelaySeconds,
  now: WallClock = nowWallClock(),
): boolean {
  return now >= releaseAt(feedTs, delaySeconds);
}
