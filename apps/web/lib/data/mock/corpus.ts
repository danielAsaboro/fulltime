/**
 * Mock corpus — deterministic World Cup fixtures. France–Morocco is the scriptable
 * star (its timeline mirrors the worker's demo: goal 23', goal 67', a swallowed
 * gap, penalty 82', FT 2–1). Other fixtures seed the /matches states (live,
 * upcoming, finished). Fixed timestamps keep SSR and CSR identical.
 */

import { asFeedTimestamp, asFixtureId, type Fixture, type Team } from "@fulltime/shared";

const team = (id: string, name: string, shortName: string, country: string): Team => ({
  id,
  name,
  shortName,
  country,
});

const TEAMS = {
  fra: team("fra", "France", "FRA", "FR"),
  mar: team("mar", "Morocco", "MAR", "MA"),
  arg: team("arg", "Argentina", "ARG", "AR"),
  por: team("por", "Portugal", "POR", "PT"),
  esp: team("esp", "Spain", "ESP", "ES"),
  bra: team("bra", "Brazil", "BRA", "BR"),
  eng: team("eng", "England", "ENG", "GB"),
  ned: team("ned", "Netherlands", "NED", "NL"),
  ger: team("ger", "Germany", "GER", "DE"),
  usa: team("usa", "USA", "USA", "US"),
  cro: team("cro", "Croatia", "CRO", "HR"),
  jpn: team("jpn", "Japan", "JPN", "JP"),
} as const;

const COMPETITION = "FIFA World Cup 2026";

/** France–Morocco kickoff — the anchor time for the scripted room. */
export const FM_KICKOFF_MS = 1_782_000_000_000;
const HOUR = 3_600_000;

export const FM_FIXTURE_ID = "9001";
export const FM_ROOM_ID = "room-fra-mar";
export const FM_INVITE_CODE = "AZZURRI"; // demo private-room code → France–Morocco

export interface MockFixtureSeed {
  fixture: Fixture;
  roomId: string;
  minute: number | null;
  score: { home: number; away: number } | null;
}

function fixture(
  id: string,
  home: Team,
  away: Team,
  kickoffMs: number,
  status: Fixture["status"],
): Fixture {
  return {
    id: asFixtureId(id),
    competition: COMPETITION,
    home,
    away,
    kickoff: asFeedTimestamp(kickoffMs),
    status,
  };
}

/**
 * Non-scripted fixtures are static; France–Morocco's live card is overlaid from
 * the scenario engine's current beat by the mock client.
 */
export const FIXTURE_SEEDS: MockFixtureSeed[] = [
  {
    fixture: fixture(FM_FIXTURE_ID, TEAMS.fra, TEAMS.mar, FM_KICKOFF_MS, "second-half"),
    roomId: FM_ROOM_ID,
    minute: 67,
    score: { home: 1, away: 1 },
  },
  {
    fixture: fixture("9002", TEAMS.arg, TEAMS.por, FM_KICKOFF_MS - 30 * 60_000, "first-half"),
    roomId: "room-arg-por",
    minute: 38,
    score: { home: 0, away: 0 },
  },
  {
    fixture: fixture("9003", TEAMS.esp, TEAMS.bra, FM_KICKOFF_MS + 3 * HOUR, "scheduled"),
    roomId: "room-esp-bra",
    minute: null,
    score: null,
  },
  {
    fixture: fixture("9004", TEAMS.eng, TEAMS.ned, FM_KICKOFF_MS + 5 * HOUR, "scheduled"),
    roomId: "room-eng-ned",
    minute: null,
    score: null,
  },
  {
    fixture: fixture("9005", TEAMS.ger, TEAMS.usa, FM_KICKOFF_MS - 26 * HOUR, "full-time"),
    roomId: "room-ger-usa",
    minute: 90,
    score: { home: 2, away: 3 },
  },
  {
    fixture: fixture("9006", TEAMS.cro, TEAMS.jpn, FM_KICKOFF_MS - 28 * HOUR, "after-penalties"),
    roomId: "room-cro-jpn",
    minute: 120,
    score: { home: 1, away: 1 },
  },
];

export const SEED_BY_FIXTURE = new Map(FIXTURE_SEEDS.map((s) => [String(s.fixture.id), s]));
export const SEED_BY_ROOM = new Map(FIXTURE_SEEDS.map((s) => [s.roomId, s]));

export const FM_TEAMS = { home: TEAMS.fra, away: TEAMS.mar };
