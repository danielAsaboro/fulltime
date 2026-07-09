/**
 * Fixtures loader. Pulls the schedule snapshot and normalizes to the shared
 * `Fixture` model. Snapshot rows carry schedule data (teams, kickoff) but not live
 * status — status arrives on the scores stream — so loaded fixtures start
 * "scheduled" and the fixture state machine advances them.
 */

import { asFixtureId, type Fixture, type Team } from "@fulltime/shared";
import { asFeedTimestamp } from "@fulltime/shared";

import type { TxlineHttp } from "./http.js";
import type { TxFixture } from "./types.js";

const MS_PER_DAY = 86_400_000;

export interface LoadFixturesOptions {
  /** Days since Unix epoch (UTC). Defaults to the API's current-day default. */
  startEpochDay?: number;
  competitionId?: number;
}

export function epochDayOf(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY);
}

export function normalizeFixture(tx: TxFixture): Fixture {
  const p1: Team = { id: String(tx.Participant1Id), name: tx.Participant1 };
  const p2: Team = { id: String(tx.Participant2Id), name: tx.Participant2 };
  const [home, away] = tx.Participant1IsHome ? [p1, p2] : [p2, p1];

  return {
    id: asFixtureId(String(tx.FixtureId)),
    competition: tx.Competition,
    home,
    away,
    kickoff: asFeedTimestamp(tx.StartTime),
    status: "scheduled",
  };
}

export async function loadFixtures(
  http: TxlineHttp,
  options: LoadFixturesOptions = {},
): Promise<Fixture[]> {
  const rows = await http.getJson<TxFixture[]>("/api/fixtures/snapshot", {
    startEpochDay: options.startEpochDay,
    competitionId: options.competitionId,
  });
  return rows.map(normalizeFixture).sort((a, b) => a.kickoff - b.kickoff);
}

/** Locate a fixture by (case-insensitive, substring) team names — e.g. "France" vs "Morocco". */
export function findFixtureByTeams(
  fixtures: readonly Fixture[],
  teamA: string,
  teamB: string,
): Fixture | undefined {
  const a = teamA.toLowerCase();
  const b = teamB.toLowerCase();
  const has = (fixture: Fixture, name: string): boolean =>
    fixture.home.name.toLowerCase().includes(name) ||
    fixture.away.name.toLowerCase().includes(name);
  return fixtures.find((fixture) => has(fixture, a) && has(fixture, b));
}
