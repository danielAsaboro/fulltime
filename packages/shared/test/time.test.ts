import { test } from "node:test";
import assert from "node:assert/strict";

import {
  asFeedTimestamp,
  asWallClock,
  nowWallClock,
} from "../src/time";

test("time brands retain supplied timestamps and generate a current wall clock", () => {
  assert.equal(asFeedTimestamp(1_000_000), 1_000_000);
  assert.equal(asWallClock(1_000_001), 1_000_001);
  assert.equal(Number.isSafeInteger(nowWallClock()), true);
});
