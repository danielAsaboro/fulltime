import assert from "node:assert/strict";
import test from "node:test";

import { selectMobileMatchdayFocus } from "../src/matchday";

const live = { phase: "live", fixture: { id: "live", kickoff: 20 } };
const next = { phase: "upcoming", fixture: { id: "next", kickoff: 30 } };

test("active live room wins the mobile matchday focus", () => {
  const room = { phase: "live", room: { id: "room-1" }, fixture: { id: "next" } };
  assert.deepEqual(selectMobileMatchdayFocus([live, next], [room]), { fixture: next, room });
});

test("mobile focus prefers live then earliest upcoming signed fixture", () => {
  assert.equal(selectMobileMatchdayFocus([next, live], []).fixture, live);
  assert.equal(selectMobileMatchdayFocus([
    { phase: "upcoming", fixture: { id: "later", kickoff: 90 } },
    next,
  ], []).fixture, next);
});

test("finished fixtures do not become a mobile cold-start hero", () => {
  assert.deepEqual(selectMobileMatchdayFocus([{ phase: "finished", fixture: { id: "done", kickoff: 1 } }], []), {
    fixture: null,
    room: null,
  });
});

test("mobile never opens a room from a different fixture hero", () => {
  const room = { phase: "live", room: { id: "room-1" }, fixture: { id: "missing" } };
  assert.deepEqual(selectMobileMatchdayFocus([live], [room]), { fixture: live, room: null });
});
