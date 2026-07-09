/**
 * Offline recorder demo. Synthesizes a short France–Morocco sequence of raw
 * `TxScores` messages (including a deliberate seq gap) and runs them through the
 * exact live pipeline — normalize → FixtureMachine → recorder — so we can show
 * corpus output and verify the spine end-to-end without live TxLINE access.
 */

import type { Logger } from "./logger.js";
import { CorpusRecorder } from "./recorder/recorder.js";
import { FixtureMachine } from "./state/fixture-machine.js";
import { ingestScore } from "./ingest.js";
import type { SoccerData, SoccerFixtureScore, TxScores } from "./txline/types.js";

const FIXTURE_ID = 900_001;
const KICKOFF_MS = 1_752_000_000_000;

function score(p1Goals: number, p2Goals: number): SoccerFixtureScore {
  const line = (goals: number) => ({ Total: { Goals: goals, YellowCards: 0, RedCards: 0, Corners: 0 } });
  return { Participant1: line(p1Goals), Participant2: line(p2Goals) };
}

interface Step {
  seq: number;
  minute: number;
  data: SoccerData;
  scoreSoccer?: SoccerFixtureScore;
}

const STEPS: Step[] = [
  { seq: 1, minute: 0, data: { StatusId: 2, Minutes: 0, Action: "kickoff" } },
  { seq: 2, minute: 12, data: { StatusId: 2, Minutes: 12, Corner: true, Participant: 1 } },
  { seq: 3, minute: 23, data: { StatusId: 2, Minutes: 23, Goal: true, Participant: 1 }, scoreSoccer: score(1, 0) },
  { seq: 4, minute: 34, data: { StatusId: 2, Minutes: 34, YellowCard: true, Participant: 2 } },
  { seq: 5, minute: 45, data: { StatusId: 3, Minutes: 45 } },
  { seq: 6, minute: 46, data: { StatusId: 4, Minutes: 46 } },
  { seq: 7, minute: 67, data: { StatusId: 4, Minutes: 67, Goal: true, Participant: 2 }, scoreSoccer: score(1, 1) },
  // seq 8 intentionally missing → the machine records a feed gap here.
  { seq: 9, minute: 80, data: { StatusId: 4, Minutes: 80, VAR: true } },
  { seq: 10, minute: 82, data: { StatusId: 4, Minutes: 82, Goal: true, Penalty: true, Participant: 1 }, scoreSoccer: score(2, 1) },
  { seq: 11, minute: 90, data: { StatusId: 5, Minutes: 90 }, scoreSoccer: score(2, 1) },
];

function buildScores(step: Step): TxScores {
  return {
    fixtureId: FIXTURE_ID,
    gameState: "",
    startTime: KICKOFF_MS,
    competitionId: 0,
    countryId: 0,
    sportId: 0,
    participant1IsHome: true,
    participant1Id: 111,
    participant2Id: 222,
    action: step.data.Action ?? "update",
    id: step.seq,
    ts: KICKOFF_MS + step.minute * 60_000,
    connectionId: 1,
    seq: step.seq,
    ...(step.scoreSoccer ? { scoreSoccer: step.scoreSoccer } : {}),
    dataSoccer: step.data,
  };
}

export async function runDemo(corpusDir: string, log: Logger): Promise<void> {
  log.info("Running offline recorder demo (France–Morocco synthetic feed)");
  const recorder = new CorpusRecorder(corpusDir, "demo", log);
  const machines = new Map<string, FixtureMachine>();

  for (const step of STEPS) {
    ingestScore(buildScores(step), machines, recorder, log);
  }

  const stats = recorder.stats();
  await recorder.close();
  log.info("Demo corpus written", {
    file: `${stats.dir}/${FIXTURE_ID}.jsonl`,
    lines: stats.lines,
  });
}
