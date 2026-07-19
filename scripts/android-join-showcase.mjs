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
  let failure = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      adb("shell", "uiautomator", "dump", "--compressed", "/sdcard/fulltime-showcase.xml");
      const hierarchy = adb("shell", "cat", "/sdcard/fulltime-showcase.xml");
      if (!hierarchy.includes("<node")) throw new Error("Android accessibility hierarchy was empty");
      return hierarchy;
    } catch (error) {
      failure = error;
      sleep(500);
    }
  }
  throw failure;
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
      package: decodeXml(attribute("package")),
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
  return Boolean(node.bounds && node.bounds[2] > node.bounds[0] && node.bounds[3] > node.bounds[1] &&
    node.bounds[2] > 0 && node.bounds[0] < 720 && node.bounds[3] > 80 && node.bounds[1] < 1464);
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
    adb("shell", "input", "swipe", "680", "1200", "680", "300", "400");
  }
  throw new Error(`Android control did not become visible after scrolling: ${value}`);
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function keyboardVisible() {
  const state = adb("shell", "dumpsys", "input_method");
  return /\bmInputShown=true\b/.test(state) || /\bmInputViewShown=true\b/.test(state);
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
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const hierarchy = xml();
    const current = nodes(hierarchy);
    const carrierCancel = current.find((node) => ["com.android.stk", "com.android.phone"].includes(node.package) && node.clickable && node.bounds && node.text === "CANCEL");
    if (carrierCancel?.bounds) {
      const [left, top, right, bottom] = carrierCancel.bounds;
      adb("shell", "input", "tap", String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
      sleep(1_500);
      continue;
    }
    if (current.some((node) => ["com.android.stk", "com.android.phone"].includes(node.package))) {
      // CANCEL can leave the carrier's own offer menu in the foreground. Use
      // system Back only for this explicit package so no offer option is
      // selected and FullTime's internal room navigation remains untouched.
      adb("shell", "input", "keyevent", "4");
      sleep(1_500);
      continue;
    }
    if (current.some((node) => matches(node, "HAVE AN INVITE?"))) return;
    const back = current.find((node) => node.clickable && visible(node) && (node.text === "‹" || node.description === "‹" || node.description.toLowerCase().includes("back")));
    if (back?.bounds) {
      const [left, top, right, bottom] = back.bounds;
      adb("shell", "input", "tap", String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
    } else {
      // A long virtualized home list can place its invite CTA outside the
      // accessibility window. Scroll toward the top before assuming that the
      // app is still inside a room. If a room header is temporarily absent
      // while refreshing, the next pass will find and tap it.
      adb("shell", "input", "swipe", "680", "350", "680", "1250", "180");
    }
    sleep(1_500);
  }
  throw new Error("Android did not reach the FullTime home screen within 60000ms");
}

function inviteInput() {
  const hierarchy = xml();
  const input = nodes(hierarchy).find((node) => node.tag.includes('class="android.widget.EditText"'));
  if (!input?.bounds) throw new Error("Android invite input is not visible");
  return input;
}

function waitForInviteInput(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return inviteInput();
    } catch (error) {
      lastError = error;
      sleep(250);
    }
  }
  throw new Error(`Android invite input did not become editable within ${timeoutMs}ms: ${lastError?.message ?? "unavailable"}`);
}

function clearInviteInput() {
  for (let attempt = 0; attempt < 80; attempt++) {
    const input = inviteInput();
    const value = input.text === "Paste room invite" ? "" : input.text;
    if (value.length === 0) return;
    const [left, top, right, bottom] = input.bounds;
    adb("shell", "input", "tap", String(Math.max(left + 1, right - 12)), String(Math.round((top + bottom) / 2)));
    const deleteCount = Math.min(96, value.length);
    adb("shell", "input", "keyevent", ...Array(deleteCount).fill("67"));
    sleep(500);
  }
  throw new Error("Android invite input could not be cleared deterministically");
}

function inputInvite(invite) {
  if (!/^ft2\.[a-z0-9.]+$/.test(invite)) throw new Error("Provisioned invite is not a canonical FullTime v2 code");
  let input = inviteInput();
  const [left, top, right, bottom] = input.bounds;
  adb("shell", "input", "tap", String(Math.max(left + 1, right - 12)), String(Math.round((top + bottom) / 2)));
  if (input.text && input.text !== "Paste room invite") {
    clearInviteInput();
  }
  const inputChunkSize = 96;
  for (let offset = 0; offset < invite.length; offset += inputChunkSize) {
    const chunk = invite.slice(offset, offset + inputChunkSize);
    adb("shell", "input", "text", chunk);
    // `adb input text` returns before every key event has drained through some
    // physical-device IMEs. Keep batches paced so a later tap cannot interrupt
    // the tail of the preceding canonical invite segment.
    sleep(750);
  }
  const deadline = Date.now() + 10_000;
  do {
    input = inviteInput();
    if (input.text === invite) return;
    sleep(250);
  } while (Date.now() < deadline);
  if (input.text !== invite) {
    const mismatch = [...invite].findIndex((character, index) => input.text[index] !== character);
    throw new Error(`Android invite input diverged at ${mismatch < 0 ? input.text.length : mismatch} for fixture admission`);
  }
}

function startJoin(fixture) {
  // Invite verification crosses the real signed-preview boundary and can still
  // be in CHECKING after the final ADB text event drains. Wait for the enabled
  // action instead of scrolling the form while validation is in flight.
  let hierarchy = xml();
  let current = nodes(hierarchy);
  if (![fixture.participant1, fixture.participant2].every((value) => current.some((node) => matches(node, value)))) {
    hierarchy = waitFor("Join with pasted invite", 60_000, ["invite has expired", "invalid invite", "could not verify"]);
    let ready = null;
    for (let scroll = 0; scroll < 12 && !ready; scroll++) {
      const readyNodes = nodes(hierarchy);
      ready = readyNodes.find((node) => node.clickable && visible(node) && matches(node, "Join with pasted invite")) ??
        readyNodes.find((node) => visible(node) && matches(node, "Join with pasted invite"));
      if (ready) break;
      adb("shell", "input", "swipe", "680", "1200", "680", "300", "300");
      sleep(500);
      hierarchy = xml();
    }
    if (!ready?.bounds) throw new Error("Validated Android join action did not become visible after scrolling");
    const [left, top, right, bottom] = ready.bounds;
    adb("shell", "input", "tap", String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    hierarchy = xml();
    current = nodes(hierarchy);
    if ([fixture.participant1, fixture.participant2].every((value) => current.some((node) => matches(node, value)))) return;
    const join = current.find((node) => node.clickable && visible(node) && matches(node, "Join with pasted invite"));
    if (join?.bounds) {
      const [left, top, right, bottom] = join.bounds;
      adb("shell", "input", "tap", String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
    }
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      hierarchy = xml();
      current = nodes(hierarchy);
      if (current.some((node) => matches(node, "Joining")) || current.some((node) => matches(node, "Checking")) ||
        [fixture.participant1, fixture.participant2].every((value) => current.some((node) => matches(node, value)))) return;
      sleep(500);
    }
  }
  throw new Error("Android join button did not enter the joining state");
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
  waitForInviteInput(15_000);
  inputInvite(room.inviteCode);
  if (keyboardVisible()) {
    adb("shell", "input", "keyevent", "4");
    sleep(500);
  }
  startJoin(fixture);
  waitForAll([fixture.participant1, fixture.participant2], 180_000, ["invite has expired", "could not join", "join failed", "has not synchronized"]);
  process.stdout.write(`Joined and opened fixture ${fixtureId} as ${room.roomId}\n`);
  ensureHome();
}

process.stdout.write(`Verified ${requestedFixtureIds.length} sequential Android room admission(s)\n`);
