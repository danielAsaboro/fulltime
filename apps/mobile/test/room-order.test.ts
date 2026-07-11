import assert from "node:assert/strict";
import test from "node:test";

import { chronologicalPage } from "../src/room-order";

test("mobile renders newest-first worker pages in send order without mutating them", () => {
  const page = Object.freeze([{ id: "third" }, { id: "second" }, { id: "first" }]);
  assert.deepEqual(chronologicalPage(page).map((item) => item.id), ["first", "second", "third"]);
  assert.deepEqual(page.map((item) => item.id), ["third", "second", "first"]);
});
