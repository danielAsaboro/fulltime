import { test } from "node:test";
import assert from "node:assert/strict";

import { impliedFromDecimal } from "../src/odds.js";

test("de-vigs a clean book to exact probabilities", () => {
  const p = impliedFromDecimal({ home: 2, draw: 4, away: 4 });
  assert.ok(p);
  assert.equal(p.home, 0.5);
  assert.equal(p.draw, 0.25);
  assert.equal(p.away, 0.25);
  assert.equal(Math.round(p.overround * 1000), 0);
});

test("removes the overround so probabilities sum to 1", () => {
  const p = impliedFromDecimal({ home: 1.9, draw: 3.5, away: 4.2 });
  assert.ok(p);
  assert.ok(p.overround > 0);
  assert.ok(Math.abs(p.home + p.draw + p.away - 1) < 1e-9);
});

test("returns null on a non-positive price", () => {
  assert.equal(impliedFromDecimal({ home: 0, draw: 3, away: 3 }), null);
});
