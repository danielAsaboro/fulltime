import type { FixtureCard, RoomView } from "@/lib/data/types";

export interface MatchdayFocus {
  fixture: FixtureCard | null;
  room: RoomView | null;
  liveCount: number;
  upcomingCount: number;
}

/**
 * Selects the most useful real match-day destination without inventing a demo
 * state. A live room wins, then any live signed fixture, then the next signed
 * fixture. Finished fixtures are history, not a cold-start hero.
 */
export function selectMatchdayFocus(
  fixtures: readonly FixtureCard[],
  rooms: readonly RoomView[],
): MatchdayFocus {
  const live = fixtures.filter((card) => card.phase === "live");
  const upcoming = fixtures
    .filter((card) => card.phase === "upcoming")
    .slice()
    .sort((a, b) => Number(a.fixture.kickoff) - Number(b.fixture.kickoff));
  const liveRoom = rooms.find((room) => room.phase === "live") ?? null;
  const roomFixture = liveRoom
    ? fixtures.find((card) => String(card.fixture.id) === String(liveRoom.fixture.id)) ?? null
    : null;

  return {
    fixture: roomFixture ?? live[0] ?? upcoming[0] ?? null,
    room: roomFixture ? liveRoom : null,
    liveCount: live.length,
    upcomingCount: upcoming.length,
  };
}

export function matchdayStatus(card: FixtureCard): string {
  if (card.phase === "live") return card.minute == null ? "Live now" : `Live · ${card.minute}'`;
  if (card.phase === "finished") return "Full-time";
  return "Next signed fixture";
}
