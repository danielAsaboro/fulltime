import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BASE_CALL_POINTS,
  MAX_DIFFICULTY_MULTIPLIER,
  callPoints,
  difficultyMultiplier,
} from "../src/scoring.js";

test("difficulty rewards the improbable and clamps the long shot", () => {
  assert.equal(difficultyMultiplier(0.5), 2);
  assert.equal(difficultyMultiplier(0.1), MAX_DIFFICULTY_MULTIPLIER);
  assert.ok(difficultyMultiplier(0.9) < 1.2);
});

test("difficulty falls back to base when odds are unusable", () => {
  assert.equal(difficultyMultiplier(0), 1);
  assert.equal(difficultyMultiplier(Number.NaN), 1);
});

test("points scale with difficulty; wrong calls score zero", () => {
  assert.equal(callPoints(true, 1), BASE_CALL_POINTS);
  assert.equal(callPoints(true, 2), 200);
  assert.equal(callPoints(false, 5), 0);
});
