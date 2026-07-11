/**
 * Time model for signed feed facts and local receipt records.
 *
 * Two clocks, kept deliberately distinct at the type level:
 *
 *  - `FeedTimestamp`  authoritative time as reported by TxLINE. Settlement,
 *                     ordering, and receipts are decided in feed time.
 *  - `WallClock`      real time on a machine (server receipt time, client now).
 *                     Used for local timestamps and anti-cheat heuristics.
 */

import type { Brand } from "./ids";

export type FeedTimestamp = Brand<number, "FeedTimestamp">;
export type WallClock = Brand<number, "WallClock">;

export const asFeedTimestamp = (msEpoch: number): FeedTimestamp => msEpoch as FeedTimestamp;
export const asWallClock = (msEpoch: number): WallClock => msEpoch as WallClock;

export const nowWallClock = (): WallClock => Date.now() as WallClock;
