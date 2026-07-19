import assert from "node:assert/strict";
import test from "node:test";

import type { FixtureCard, RoomView } from "../lib/data/types";
import { matchdayStatus, selectMatchdayFocus } from "../lib/matchday";

function fixture(id: string, phase: FixtureCard["phase"], kickoff: number, minute: number | null = null): FixtureCard {
  return {
    fixture: {
      id,
      competition: "World Cup",
      kickoff,
      home: { id: `${id}:h`, name: `Home ${id}`, country: "Nigeria" },
      away: { id: `${id}:a`, name: `Away ${id}`, country: "Ghana" },
    },
    phase,
    status: phase === "live" ? "second-half" : phase === "finished" ? "finished" : "scheduled",
    score: phase === "upcoming" ? null : { home: 1, away: 0 },
    minute,
  } as FixtureCard;
}

function room(card: FixtureCard): RoomView {
  return {
    room: { id: `room:${card.fixture.id}`, name: "Match room", fixtureId: card.fixture.id },
    fixture: card.fixture,
    phase: card.phase,
    members: 2,
  } as RoomView;
}

test("matchday focus prefers the user's live room over another live fixture", () => {
  const first = fixture("first", "live", 20, 61);
  const mine = fixture("mine", "live", 10, 72);
  const focus = selectMatchdayFocus([first, mine], [room(mine)]);
  assert.equal(focus.fixture?.fixture.id, "mine");
  assert.equal(focus.room?.room.id, "room:mine");
  assert.equal(focus.liveCount, 2);
});

test("matchday focus prefers live, then the earliest upcoming signed fixture", () => {
  const late = fixture("late", "upcoming", 300);
  const early = fixture("early", "upcoming", 100);
  const live = fixture("live", "live", 200, 12);
  assert.equal(selectMatchdayFocus([late, early, live], []).fixture?.fixture.id, "live");
  assert.equal(selectMatchdayFocus([late, early], []).fixture?.fixture.id, "early");
});

test("finished fixtures never become a cold-start matchday hero", () => {
  const focus = selectMatchdayFocus([fixture("done", "finished", 10)], []);
  assert.equal(focus.fixture, null);
});

test("a room is never paired with a different fixture hero", () => {
  const other = fixture("other", "live", 20, 10);
  const missing = fixture("missing", "live", 10, 12);
  const focus = selectMatchdayFocus([other], [room(missing)]);
  assert.equal(focus.fixture?.fixture.id, "other");
  assert.equal(focus.room, null);
});

test("matchday status is concise and feed-specific", () => {
  assert.equal(matchdayStatus(fixture("a", "live", 0, 44)), "Live · 44'");
  assert.equal(matchdayStatus(fixture("b", "live", 0)), "Live now");
  assert.equal(matchdayStatus(fixture("c", "upcoming", 0)), "Next signed fixture");
});
