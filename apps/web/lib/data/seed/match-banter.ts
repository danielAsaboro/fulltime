/**
 * Seed banter packs — World Cup-style chat energy for empty rooms.
 * Users one-tap post these through the real composer (real peer write, not fake history).
 * Inspired by Onside/FanField/SuperSub social density Daniel asked Tim to harvest.
 */

export interface BanterLine {
  id: string;
  text: string;
  /** Optional mood for UI chips */
  mood: "hype" | "cope" | "call" | "react" | "tactics";
}

export interface FixtureBanterPack {
  /** Fixture id fragment or short codes matched loosely */
  keys: string[];
  label: string;
  lines: BanterLine[];
}

const GENERIC: BanterLine[] = [
  { id: "g1", text: "phones out, streams on — who is actually on time tonight", mood: "hype" },
  { id: "g2", text: "if this stays 0-0 for 70 I'm going insane", mood: "cope" },
  { id: "g3", text: "first goal decides the whole room mood fr", mood: "call" },
  { id: "g4", text: "don't spoil me I'm on a 30s delay", mood: "react" },
  { id: "g5", text: "set piece coming and my heart knows it", mood: "tactics" },
  { id: "g6", text: "who is backing a card in the next 10", mood: "call" },
  { id: "g7", text: "this midfield is pure chaos and I love it", mood: "hype" },
  { id: "g8", text: "Market Says can talk but my eyes are on the box", mood: "tactics" },
  { id: "g9", text: "back your stand or stay quiet — Fan IQ is watching", mood: "call" },
  { id: "g10", text: "if you check scores on another screen that's on you not this room", mood: "react" },
  { id: "g11", text: "remontada energy loading if we hold till 70", mood: "hype" },
  { id: "g12", text: "drop a poll before the next attack wave", mood: "call" },
];

const PACKS: FixtureBanterPack[] = [
  {
    keys: ["fra", "esp", "france", "spain", "18237038"],
    label: "France–Spain energy",
    lines: [
      { id: "fs1", text: "France technical vs Spain control — who blinks first", mood: "tactics" },
      { id: "fs2", text: "if Mbappé gets a run I'm not calming down", mood: "hype" },
      { id: "fs3", text: "Spain will keep the ball for 12 minutes straight watch", mood: "call" },
      { id: "fs4", text: "this is a final dressed as a semi", mood: "hype" },
      { id: "fs5", text: "one red card and the whole slip board goes nuclear", mood: "react" },
    ],
  },
  {
    keys: ["eng", "arg", "england", "argentina", "18241006"],
    label: "England–Argentina energy",
    lines: [
      { id: "ea1", text: "historic beef energy even if the XI is new", mood: "hype" },
      { id: "ea2", text: "set pieces will decide this I can feel it", mood: "tactics" },
      { id: "ea3", text: "who is calling the first yellow", mood: "call" },
      { id: "ea4", text: "if this goes to pens the room will combust", mood: "cope" },
    ],
  },
  {
    keys: ["mar", "morocco", "fra-mar", "room-fra-mar"],
    label: "France–Morocco energy",
    lines: [
      { id: "fm1", text: "Morocco on the break is a different sport", mood: "hype" },
      { id: "fm2", text: "France need a second goal or this gets spicy", mood: "tactics" },
      { id: "fm3", text: "every corner feels like a plot twist", mood: "react" },
    ],
  },
  {
    keys: ["bra", "brazil", "ger", "germany"],
    label: "Brazil–Germany energy",
    lines: [
      { id: "bg1", text: "one team is chaos the other is a spreadsheet", mood: "tactics" },
      { id: "bg2", text: "if this opens up early the room never recovers", mood: "hype" },
    ],
  },
  {
    keys: ["por", "portugal", "ned", "netherlands", "holland"],
    label: "Portugal–Netherlands energy",
    lines: [
      { id: "pn1", text: "set pieces and drama — pick your poison", mood: "call" },
      { id: "pn2", text: "first red card and the Slip board lights up", mood: "react" },
    ],
  },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Resolve banter for a fixture using id / names / short codes. */
export function banterForFixture(input: {
  fixtureId?: string;
  homeName?: string;
  awayName?: string;
  homeCode?: string | null;
  awayCode?: string | null;
  roomName?: string;
}): BanterLine[] {
  const haystack = normalize(
    [input.fixtureId, input.homeName, input.awayName, input.homeCode, input.awayCode, input.roomName]
      .filter(Boolean)
      .join(" "),
  );
  const matched = PACKS.filter((pack) => pack.keys.some((key) => haystack.includes(normalize(key))));
  const lines = matched.flatMap((pack) => pack.lines);
  const seen = new Set<string>();
  const merged: BanterLine[] = [];
  for (const line of [...lines, ...GENERIC]) {
    if (seen.has(line.id)) continue;
    seen.add(line.id);
    merged.push(line);
  }
  return merged.slice(0, 8);
}
