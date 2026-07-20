#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const device = process.argv[2];
const roomsPath = process.argv[3];
const requestedFixtureIds = process.argv.slice(4);
if (!device || !roomsPath || requestedFixtureIds.length === 0) {
  throw new Error("Usage: android-join-showcase.mjs <device> <rooms-json> <fixture-id> [fixture-id ...]");
}

const provisioned = JSON.parse(fs.readFileSync(roomsPath, "utf8"));
const byFixture = new Map((provisioned.rooms ?? []).map((room) => [String(room.fixtureId), room]));
const fixtureIndexPath = path.resolve("../resources/fixtures/world-cup-2026/index.json");
const fixtureIndex = JSON.parse(fs.readFileSync(fixtureIndexPath, "utf8"));
const fixturesById = new Map((fixtureIndex.fixtures ?? []).map((fixture) => [String(fixture.fixtureId), fixture]));
const showcaseDataRoot = path.resolve("data/world-cup-2026");
for (const fixtureId of requestedFixtureIds) {
  if (fixturesById.has(String(fixtureId))) continue;
  const directory = fs.readdirSync(showcaseDataRoot).find((entry) => entry.startsWith(`${fixtureId}-`));
  const archiveFixturePath = directory && path.join(showcaseDataRoot, directory, "archive", "fixture.json");
  if (!archiveFixturePath || !fs.existsSync(archiveFixturePath)) continue;
  const fixture = JSON.parse(fs.readFileSync(archiveFixturePath, "utf8"));
  fixturesById.set(String(fixtureId), {
    fixtureId: String(fixture.FixtureId),
    participant1: fixture.Participant1,
    participant2: fixture.Participant2,
  });
}

function adb(...args) {
  const result = spawnSync("adb", ["-s", device, ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `adb ${args.join(" ")} failed`);
  return result.stdout;
}

function xml() {
  adb("shell", "uiautomator", "dump", "/sdcard/fulltime-showcase.xml");
  return adb("shell", "cat", "/sdcard/fulltime-showcase.xml");
}

function nodes(hierarchy) {
  const decodeXml = (value) => value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
  return [...hierarchy.matchAll(/<node\b[^>]*>/g)].map((match) => {
    const tag = match[0];
    const attribute = (name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "";
    const bounds = attribute("bounds").match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
    return {
      tag,
      text: decodeXml(attribute("text")),
      description: decodeXml(attribute("content-desc")),
      clickable: attribute("clickable") === "true",
      bounds: bounds ? bounds.slice(1).map(Number) : null,
    };
  });
}

function matches(node, value) {
  const needle = value.toLowerCase();
  return node.text.toLowerCase().includes(needle) || node.description.toLowerCase().includes(needle);
}

function visible(node) {
  return Boolean(node.bounds && node.bounds[2] > node.bounds[0] && node.bounds[3] > node.bounds[1]);
}

function tapNode(value) {
  const hierarchy = xml();
  const candidate = nodes(hierarchy).find((node) => node.clickable && visible(node) && matches(node, value)) ??
    nodes(hierarchy).find((node) => visible(node) && matches(node, value));
  if (!candidate?.bounds) throw new Error(`Android control is not visible: ${value}`);
  const [left, top, right, bottom] = candidate.bounds;
  adb("shell", "input", "tap", String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
}

function tapAfterScrolling(value) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const hierarchy = xml();
    const candidate = nodes(hierarchy).find((node) => node.clickable && visible(node) && matches(node, value));
    if (candidate) {
      const [left, top, right, bottom] = candidate.bounds;
      adb("shell", "input", "tap", String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
      return;
    }
    adb("shell", "input", "swipe", "360", "1200", "360", "300", "400");
  }
  throw new Error(`Android control did not become visible after scrolling: ${value}`);
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function waitFor(value, timeoutMs, failureNeedles = []) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = xml();
    if (nodes(last).some((node) => matches(node, value))) return last;
    for (const failure of failureNeedles) {
      if (nodes(last).some((node) => matches(node, failure))) {
        throw new Error(`Android join failed: ${failure}`);
      }
    }
    sleep(1_000);
  }
  throw new Error(`Android did not show ${value} within ${timeoutMs}ms`);
}

function waitForAll(values, timeoutMs, failureNeedles = []) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hierarchy = xml();
    const current = nodes(hierarchy);
    if (values.every((value) => current.some((node) => matches(node, value)))) return hierarchy;
    for (const failure of failureNeedles) {
      if (current.some((node) => matches(node, failure))) throw new Error(`Android join failed: ${failure}`);
    }
    sleep(1_000);
  }
  throw new Error(`Android did not show ${values.join(" + ")} within ${timeoutMs}ms`);
}

function ensureHome() {
  let hierarchy = xml();
  if (nodes(hierarchy).some((node) => matches(node, "HAVE AN INVITE?"))) return;
  const back = nodes(hierarchy).find((node) => node.clickable && node.bounds && (node.text === "‹" || node.description.toLowerCase().includes("back")));
  if (back?.bounds) {
    const [left, top, right, bottom] = back.bounds;
    adb("shell", "input", "tap", String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
  } else {
    // Some room headers render their back glyph as a non-accessible canvas
    // node. Tap the visible top-left room control; Android's system back exits
    // the single-activity app instead of navigating its internal room state.
    adb("shell", "input", "tap", "55", "155");
  }
  waitFor("HAVE AN INVITE?", 15_000);
}

function inviteInput() {
  const hierarchy = xml();
  const input = nodes(hierarchy).find((node) => node.tag.includes('class="android.widget.EditText"') &&
    (node.text.includes("ft2.") || node.text === "Paste room invite"));
  if (!input?.bounds) throw new Error("Android invite input is not visible");
  return input;
}

function inputInvite(invite) {
  if (!/^ft2\.[a-z0-9.]+$/.test(invite)) throw new Error("Provisioned invite is not a canonical FullTime v2 code");
  let input = inviteInput();
  const [left, top, right, bottom] = input.bounds;
  adb("shell", "input", "tap", String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
  if (input.text && input.text !== "Paste room invite") {
    const clearCount = input.text.length + 8;
    for (const keyCode of ["67", "112"]) {
      for (let offset = 0; offset < clearCount; offset += 80) {
        adb("shell", "input", "keyevent", ...Array(Math.min(80, clearCount - offset)).fill(keyCode));
      }
    }
  }
  for (let offset = 0; offset < invite.length; offset += 120) {
    const chunk = invite.slice(offset, offset + 120);
    adb("shell", "input", "text", chunk);
    input = inviteInput();
    const expected = invite.slice(0, offset + chunk.length);
    if (input.text !== expected) {
      const mismatch = [...expected].findIndex((character, index) => input.text[index] !== character);
      throw new Error(`Android invite input diverged at ${mismatch} for fixture admission`);
    }
  }
}

for (const fixtureId of requestedFixtureIds) {
  const room = byFixture.get(String(fixtureId));
  if (!room || typeof room.inviteCode !== "string" || typeof room.roomId !== "string") {
    throw new Error(`Provisioned room is unavailable for fixture ${fixtureId}`);
  }
  const fixture = fixturesById.get(String(fixtureId));
  if (!fixture?.participant1 || !fixture?.participant2) throw new Error(`Fixture identity is unavailable for ${fixtureId}`);
  ensureHome();
  tapNode("HAVE AN INVITE?");
  waitFor("Paste room invite", 15_000);
  inputInvite(room.inviteCode);
  adb("shell", "input", "keyevent", "4");
  tapAfterScrolling("Join with pasted invite");
  waitForAll([fixture.participant1, fixture.participant2], 180_000, ["invite has expired", "could not join", "join failed", "has not synchronized"]);
  process.stdout.write(`Joined and opened fixture ${fixtureId} as ${room.roomId}\n`);
  ensureHome();
}

process.stdout.write(`Verified ${requestedFixtureIds.length} sequential Android room admission(s)\n`);
