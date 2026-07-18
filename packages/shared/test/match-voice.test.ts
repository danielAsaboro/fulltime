import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MatchEvent } from "../src/events.js";
import {
  boothClipsForReleasedEvent,
  boothClipsForRoomMoment,
  catchMeUpClips,
  voicePackTemplates,
} from "../src/match-voice.js";

const teams = { home: "Brazil", away: "France" };

function event(partial: Partial<MatchEvent> & Pick<MatchEvent, "kind">): MatchEvent {
  return {
    id: "e1" as MatchEvent["id"],
    fixtureId: "f1" as MatchEvent["fixtureId"],
    feedTs: 1 as MatchEvent["feedTs"],
    messageId: null,
    minute: 67,
    side: "away",
    ...partial,
  };
}

describe("room radio voice", () => {
  it("catch-me-up is room temperature + market, not pure score PA", () => {
    const clips = catchMeUpClips({
      teams,
      phase: "live",
      statusLabel: "live",
      score: { home: 1, away: 0 },
      minute: 62,
      majoritySide: "the draw",
      majorityShare: 0.38,
      hottestMarketLine: "Room still on the draw at 38%",
      lastBigCall: "next goal home",
    });
    assert.ok(clips.length >= 2);
    assert.ok(clips.every((c) => c.role === "booth"));
    const joined = clips.map((c) => c.text).join(" ");
    assert.match(joined, /draw|room|market|call/i);
    assert.doesNotMatch(joined, /Peter Drury|play-by-play/i);
  });

  it("odds-as-drama pairs red card with market + open stands", () => {
    const clips = boothClipsForReleasedEvent({
      event: event({ kind: "red-card" }),
      teams,
      market: {
        id: "m1",
        fixtureId: "f1" as never,
        kind: "swing",
        feedTs: 1 as never,
        text: "Away win just jumped from 41 to 58",
        evidence: {},
      },
      openStandsTouching: 3,
      personal: {
        hasOpenStand: true,
        standLabel: "the under",
        underPressure: true,
        youreUpIfHolds: false,
        streakLength: 3,
        streakAtRisk: true,
      },
    });
    assert.ok(clips.some((c) => c.role === "booth"));
    assert.ok(clips.some((c) => c.role === "book"));
    const booth = clips.find((c) => c.role === "booth")!.text;
    assert.match(booth, /red card/i);
    assert.match(booth, /41|58|Away|market/i);
    const book = clips.filter((c) => c.role === "book").map((c) => c.text).join(" ");
    assert.match(book, /under|streak|book/i);
  });

  it("room moments cover stands and polls without pitch events", () => {
    const stand = boothClipsForRoomMoment({
      kind: "stand-locked",
      teams,
      label: "Brazil next goal",
      personal: true,
    });
    assert.equal(stand[0]!.role, "book");
    assert.match(stand[0]!.text, /Stand locked|Brazil/i);

    const poll = boothClipsForRoomMoment({
      kind: "poll-closed",
      teams,
      label: "Who wins the half?",
      detail: "draw",
    });
    assert.match(poll[0]!.text, /Poll closed/i);
  });

  it("stays quiet for low-signal pitch kinds", () => {
    const clips = boothClipsForReleasedEvent({
      event: event({ kind: "corner" }),
      teams,
      market: null,
      openStandsTouching: 0,
      personal: {
        hasOpenStand: false,
        standLabel: null,
        underPressure: false,
        youreUpIfHolds: false,
        streakLength: 0,
        streakAtRisk: false,
      },
    });
    assert.deepEqual(clips, []);
  });

  it("voice pack is room radio not 90-minute PA", () => {
    const pack = voicePackTemplates(teams);
    assert.ok(pack.length >= 3);
    assert.ok(pack.every((c) => c.text.length > 0));
  });
});
