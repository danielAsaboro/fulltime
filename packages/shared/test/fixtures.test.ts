import { test } from "node:test";
import assert from "node:assert/strict";

import { isLiveFixtureStatus, isTerminalFixtureStatus } from "../src/fixtures.js";

test("a decided match is terminal; an in-progress shootout is not", () => {
  assert.equal(isTerminalFixtureStatus("after-penalties"), true);
  assert.equal(isTerminalFixtureStatus("full-time"), true);
  assert.equal(isTerminalFixtureStatus("abandoned"), true);
  assert.equal(isTerminalFixtureStatus("penalty-shootout"), false);
});

test("live statuses are exactly the in-play phases", () => {
  assert.equal(isLiveFixtureStatus("first-half"), true);
  assert.equal(isLiveFixtureStatus("penalty-shootout"), true);
  assert.equal(isLiveFixtureStatus("half-time"), false);
  assert.equal(isLiveFixtureStatus("full-time"), false);
});
