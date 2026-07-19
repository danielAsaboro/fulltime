export type MobileMatchdayCard = {
  phase?: string;
  fixture?: { id?: string | number; kickoff?: number };
};

export type MobileRoomSummary = {
  phase?: string;
  room?: { id?: string | number };
  fixture?: { id?: string | number };
};

export function selectMobileMatchdayFocus(
  fixtures: MobileMatchdayCard[],
  rooms: MobileRoomSummary[],
): { fixture: MobileMatchdayCard | null; room: MobileRoomSummary | null } {
  const activeRoom = rooms.find((room) => room.phase === "live") ?? null;
  if (activeRoom) {
    const roomFixtureId = String(activeRoom.fixture?.id ?? "");
    const fixture = fixtures.find((card) => String(card.fixture?.id ?? "") === roomFixtureId) ?? null;
    if (fixture) return { fixture, room: activeRoom };
  }

  const live = fixtures.find((card) => card.phase === "live") ?? null;
  if (live) return { fixture: live, room: null };

  const upcoming = fixtures
    .filter((card) => card.phase === "upcoming")
    .sort((left, right) => Number(left.fixture?.kickoff ?? Infinity) - Number(right.fixture?.kickoff ?? Infinity))[0] ?? null;
  return { fixture: upcoming, room: null };
}
