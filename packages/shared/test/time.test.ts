import { test } from "node:test";
import assert from "node:assert/strict";

import {
  asFeedTimestamp,
  asWallClock,
  clampDelaySeconds,
  isReleased,
  msUntilRelease,
  releaseAt,
} from "../src/time";

test("releaseAt adds the delay (in ms) to feed time", () => {
  assert.equal(releaseAt(asFeedTimestamp(1_000_000), 8), 1_008_000);
});

test("clampDelaySeconds bounds the range and guards NaN", () => {
  assert.equal(clampDelaySeconds(-5), 0);
  assert.equal(clampDelaySeconds(999), 180);
  assert.equal(clampDelaySeconds(Number.NaN), 0);
});

test("isReleased flips exactly at feed_ts + D", () => {
  const feedTs = asFeedTimestamp(1_000_000);
  assert.equal(isReleased(feedTs, 42, asWallClock(1_000_000 + 41_999)), false);
  assert.equal(isReleased(feedTs, 42, asWallClock(1_000_000 + 42_000)), true);
});

test("msUntilRelease is never negative", () => {
  const feedTs = asFeedTimestamp(1_000_000);
  assert.equal(msUntilRelease(feedTs, 8, asWallClock(2_000_000)), 0);
  assert.equal(msUntilRelease(feedTs, 8, asWallClock(1_000_000)), 8_000);
});

test("MatchSync: one event releases to different viewers at different times", () => {
  const goal = asFeedTimestamp(1_000_000);
  assert.equal(releaseAt(goal, 8), 1_008_000);
  assert.equal(releaseAt(goal, 42), 1_042_000);
});
