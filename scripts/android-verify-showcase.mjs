#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const device = process.argv[2];
const roomsPath = path.resolve(process.argv[3] ?? "");
if (!device || !roomsPath) throw new Error("Usage: android-verify-showcase.mjs <device> <rooms-json>");

function adb(...args) {
  const result = spawnSync("adb", ["-s", device, ...args], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `adb ${args.join(" ")} failed`);
  return result.stdout;
}

function hierarchy() {
  adb("shell", "uiautomator", "dump", "/sdcard/fulltime-showcase-verify.xml");
  return adb("shell", "cat", "/sdcard/fulltime-showcase-verify.xml")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataRoot = path.join(repoRoot, "data/world-cup-2026");
const provisioned = JSON.parse(fs.readFileSync(roomsPath, "utf8"));
const expected = (provisioned.rooms ?? []).map((room) => {
  const directory = fs.readdirSync(dataRoot).find((entry) => entry.startsWith(`${room.fixtureId}-`));
  const seedPath = directory && path.join(dataRoot, directory, "room-seed.json");
  if (!seedPath || !fs.existsSync(seedPath)) throw new Error(`Room seed is unavailable for fixture ${room.fixtureId}`);
  const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const fixturePath = path.resolve(path.dirname(seedPath), seed.evidence?.fixture ?? "archive/fixture.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  return { fixtureId: String(room.fixtureId), participant1: fixture.Participant1, participant2: fixture.Participant2 };
});

let current = hierarchy();
if (!current.includes("HAVE AN INVITE?")) {
  const back = current.match(/content-desc="‹"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (back) {
    adb("shell", "input", "tap", String(Math.round((Number(back[1]) + Number(back[3])) / 2)), String(Math.round((Number(back[2]) + Number(back[4])) / 2)));
  } else {
    // The home list may itself be scrolled far enough that its invite CTA is
    // outside the accessibility window. Return to the top before classifying it.
    for (let index = 0; index < 16; index++) adb("shell", "input", "swipe", "360", "350", "360", "1250", "180");
    current = hierarchy();
    if (!current.includes("HAVE AN INVITE?")) throw new Error("Android FullTime home or room back control is unavailable");
  }
}

// Reset the virtualized room list to its top, then walk it in sub-screen steps.
// A near-full-screen swipe can skip a row entirely on compact Android devices.
for (let index = 0; index < 16; index++) adb("shell", "input", "swipe", "360", "350", "360", "1250", "180");
const seen = new Set();
for (let page = 0; page < 32; page++) {
  current = hierarchy();
  for (const fixture of expected) {
    if (current.includes(fixture.participant1) && current.includes(fixture.participant2)) seen.add(fixture.fixtureId);
  }
  if (seen.size === expected.length) break;
  adb("shell", "input", "swipe", "360", "1100", "360", "650", "220");
}

const missing = expected.filter((fixture) => !seen.has(fixture.fixtureId));
if (missing.length) {
  throw new Error(`Android room list is missing fixtures: ${missing.map((fixture) => fixture.fixtureId).join(", ")}; observed: ${[...seen].join(", ")}`);
}
process.stdout.write(`${JSON.stringify({ verifiedRoomCount: seen.size, fixtureIds: expected.map((fixture) => fixture.fixtureId) }, null, 2)}\n`);
