#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const device = process.argv[2];
const roomsPath = path.resolve(process.argv[3] ?? "");
if (!device || !roomsPath) {
  throw new Error("Usage: ios-join-showcase-all.mjs <device> <rooms-json>");
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const productsDir = path.join(repoRoot, "apps/mobile/.local-development/ios-ui-test-derived-data/Build/Products");
const dataRoot = path.join(repoRoot, "data/world-cup-2026");
const evidenceRoot = path.join(repoRoot, "evidence/physical-e2e");
const provisioned = JSON.parse(fs.readFileSync(roomsPath, "utf8"));
const directories = fs.readdirSync(dataRoot);
const allRooms = (provisioned.rooms ?? []).map((room) => {
  if (typeof room.inviteCode !== "string" || !/^ft2\.[a-z0-9.]+$/.test(room.inviteCode)) {
    throw new Error(`Provisioned room invite is unavailable for fixture ${room.fixtureId}`);
  }
  const directory = directories.find((entry) => entry.startsWith(`${room.fixtureId}-`));
  const seedPath = directory && path.join(dataRoot, directory, "room-seed.json");
  if (!seedPath || !fs.existsSync(seedPath)) throw new Error(`Room seed is unavailable for fixture ${room.fixtureId}`);
  const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const fixtureReference = seed.evidence?.fixture ?? "archive/fixture.json";
  const localFixturePath = path.resolve(path.dirname(seedPath), fixtureReference);
  const fixturePath = fs.existsSync(localFixturePath) ? localFixturePath : path.resolve(repoRoot, fixtureReference);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  if (String(fixture.FixtureId) !== String(room.fixtureId) || !fixture.Participant1 || !fixture.Participant2) {
    throw new Error(`Verified archive identity does not match fixture ${room.fixtureId}`);
  }
  return {
    fixtureID: String(room.fixtureId),
    participant1: fixture.Participant1,
    participant2: fixture.Participant2,
    invite: room.inviteCode,
    kickoff: Number(fixture.StartTime),
  };
}).sort((left, right) => left.kickoff - right.kickoff || left.fixtureID.localeCompare(right.fixtureID));

const EXPECTED_SHOWCASE_ROOM_COUNT = 104;

if (allRooms.length !== EXPECTED_SHOWCASE_ROOM_COUNT || new Set(allRooms.map((room) => room.fixtureID)).size !== allRooms.length) {
  throw new Error(`Expected ${EXPECTED_SHOWCASE_ROOM_COUNT} unique provisioned fixtures, received ${allRooms.length}`);
}

// XCTest result bundles retain a marker only after the physical device shows
// the signed fixture and room composer. Treat those markers as resumable
// device evidence so an interrupted multi-hour run never rejoins or skips a
// partially admitted room. This reads fixture IDs only; invite values never
// enter logs or the result bundle.
const completedFixtureIds = process.env.FULLTIME_IOS_SHOWCASE_IGNORE_EVIDENCE === "1"
  ? new Set()
  : readCompletedFixtureIds(evidenceRoot);
const remainingRooms = allRooms.filter((room) => !completedFixtureIds.has(room.fixtureID));
if (remainingRooms.length === 0) {
  process.stdout.write(`All ${EXPECTED_SHOWCASE_ROOM_COUNT} sequential iPhone showcase room admissions already have retained XCTest evidence\n`);
  process.exit(0);
}
const batchSize = Number(process.env.FULLTIME_IOS_SHOWCASE_BATCH_SIZE ?? 6);
if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 12) {
  throw new Error("FULLTIME_IOS_SHOWCASE_BATCH_SIZE must be an integer from 1 to 12");
}
// Restart the Release process between bounded batches. Closed Autobases release
// their active handles immediately, while process boundaries ensure V8 returns
// native allocations before a long physical corpus verification can continue.
const rooms = remainingRooms.slice(0, batchSize);
process.stdout.write(`Resuming iPhone showcase admission with ${completedFixtureIds.size} verified, ${remainingRooms.length} remaining, and ${rooms.length} in this bounded batch\n`);
const inviteByFixtureId = new Map(rooms.map((room) => [room.fixtureID, room.invite]));

const payload = Buffer.from(JSON.stringify(rooms.map(({ kickoff: _kickoff, ...room }) => room)), "utf8").toString("base64");
const testRunName = fs.readdirSync(productsDir).find((name) => name.endsWith(".xctestrun") && !name.startsWith("."));
if (!testRunName) throw new Error("No iOS .xctestrun exists; build FullTime for testing first");
const privateTestRunPath = path.join(productsDir, `.fulltime-showcase-all-${process.pid}.xctestrun`);
fs.copyFileSync(path.join(productsDir, testRunName), privateTestRunPath, fs.constants.COPYFILE_EXCL);
fs.chmodSync(privateTestRunPath, 0o600);

const configured = spawnSync("/usr/libexec/PlistBuddy", [
  "-c",
  `Add :FullTimeTests:EnvironmentVariables:FULLTIME_TEST_SHOWCASE_ROOMS_BASE64 string ${payload}`,
  privateTestRunPath,
], { stdio: "pipe" });
if (configured.status !== 0) {
  fs.unlinkSync(privateTestRunPath);
  throw new Error("Could not configure the private iPhone showcase corpus payload");
}

fs.mkdirSync(evidenceRoot, { recursive: true });
const resultPath = path.join(evidenceRoot, `ios-showcase-all-${Date.now()}.xcresult`);
const checkpointPath = `${resultPath}.completed.json`;
const runCompletedFixtureIds = new Set();
const originalClipboard = readClipboard();
let clipboardRestored = false;
const restoreClipboard = () => {
  if (clipboardRestored) return;
  clipboardRestored = true;
  writeClipboard(originalClipboard);
};
process.once("exit", restoreClipboard);

let resultStatus = 1;
try {
  const child = spawn("xcodebuild", [
    "-quiet",
    "-xctestrun", privateTestRunPath,
    // Xcode 26 can expose the same physical iPhone as both arm64e and arm64.
    // Select the app/test architecture explicitly so it does not choose the
    // arm64e destination whose DeviceSupport image is unavailable on this host.
    "-destination", `platform=iOS,id=${device},arch=arm64`,
    "-resultBundlePath", resultPath,
    "-allowProvisioningUpdates",
    "test-without-building",
    "-only-testing:FullTimeTests/FullTimeUITests/testJoinAllShowcaseRooms",
  ], { cwd: repoRoot, stdio: "inherit" });
  const requested = new Set();
  const logState = new Map();
  const scan = () => scanLiveTestEvents(resultPath, logState, {
    onClipboardRequest(fixtureID, attempt) {
      const signature = `${fixtureID}:${attempt}`;
      if (requested.has(signature)) return;
      const invite = inviteByFixtureId.get(fixtureID);
      if (!invite) throw new Error(`iPhone requested an invite for unknown fixture ${fixtureID}`);
      writeClipboard(Buffer.from(invite, "utf8"));
      requested.add(signature);
      process.stdout.write(`Prepared private invite for fixture ${fixtureID} (attempt ${attempt})\n`);
    },
    onJoined(fixtureID) {
      if (!inviteByFixtureId.has(fixtureID) || runCompletedFixtureIds.has(fixtureID)) return;
      runCompletedFixtureIds.add(fixtureID);
      writeCheckpoint(checkpointPath, resultPath, device, runCompletedFixtureIds);
      process.stdout.write(`Retained physical iPhone evidence for fixture ${fixtureID} (${completedFixtureIds.size + runCompletedFixtureIds.size}/${EXPECTED_SHOWCASE_ROOM_COUNT})\n`);
    },
  });
  const timer = setInterval(() => {
    try { scan(); } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      child.kill("SIGTERM");
    }
  }, 250);
  try {
    resultStatus = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (signal) process.stderr.write(`xcodebuild exited after ${signal}\n`);
        resolve(code ?? 1);
      });
    });
    scan();
  } finally {
    clearInterval(timer);
  }
} finally {
  fs.unlinkSync(privateTestRunPath);
  restoreClipboard();
  process.removeListener("exit", restoreClipboard);
}

if (resultStatus !== 0) throw new Error(`iPhone showcase corpus join failed; resume evidence: ${resultPath}`);
process.stdout.write(`Verified ${rooms.length} new sequential iPhone showcase room admissions (${completedFixtureIds.size + rooms.length}/${EXPECTED_SHOWCASE_ROOM_COUNT} total, ${remainingRooms.length - rooms.length} remaining); evidence: ${resultPath}\n`);

function readCompletedFixtureIds(root) {
  const completed = new Set();
  if (!fs.existsSync(root)) return completed;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && /^ios-showcase-all-\d+\.xcresult\.completed\.json$/.test(entry.name)) {
      const checkpoint = JSON.parse(fs.readFileSync(path.join(root, entry.name), "utf8"));
      if (checkpoint?.schemaVersion !== 1 || !Array.isArray(checkpoint.completedFixtureIds)) {
        throw new Error(`Invalid iPhone showcase checkpoint ${entry.name}`);
      }
      for (const fixtureID of checkpoint.completedFixtureIds) {
        if (!/^[0-9]+$/.test(fixtureID)) throw new Error(`Invalid fixture ID in ${entry.name}`);
        completed.add(fixtureID);
      }
      continue;
    }
    if (!entry.isDirectory() || !/^ios-showcase-all-\d+\.xcresult$/.test(entry.name)) continue;
    for (const filename of findSessionLogs(path.join(root, entry.name))) {
      scanMarkers(filename, completed);
    }
  }
  return completed;
}

function findSessionLogs(root) {
  const found = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(filename);
      else if (/^Session-.*\.log$/.test(entry.name)) found.push(filename);
    }
  }
  return found;
}

function scanMarkers(filename, completed) {
  const descriptor = fs.openSync(filename, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let carry = "";
  try {
    for (;;) {
      const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      const text = carry + buffer.toString("utf8", 0, bytes);
      const lines = text.split(/\r?\n/);
      carry = lines.pop() ?? "";
      for (const line of lines) {
        const match = line.match(/FULLTIME_SHOWCASE_JOINED ([0-9]+)/);
        if (match) completed.add(match[1]);
      }
    }
    const match = carry.match(/FULLTIME_SHOWCASE_JOINED ([0-9]+)/);
    if (match) completed.add(match[1]);
  } finally {
    fs.closeSync(descriptor);
  }
}

function readClipboard() {
  const result = spawnSync("pbpaste", [], { encoding: "buffer", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 && Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
}

function writeClipboard(value) {
  const result = spawnSync("pbcopy", [], { input: value, stdio: ["pipe", "ignore", "ignore"] });
  if (result.status !== 0) throw new Error("Could not update the Universal Clipboard for the physical iPhone");
}

function scanLiveTestEvents(root, state, { onClipboardRequest, onJoined }) {
  for (const filename of findSessionLogs(root)) {
    const previous = state.get(filename) ?? { offset: 0, carry: "" };
    let stat;
    try { stat = fs.statSync(filename); } catch { continue; }
    if (stat.size < previous.offset) {
      previous.offset = 0;
      previous.carry = "";
    }
    if (stat.size === previous.offset) continue;
    const length = stat.size - previous.offset;
    const buffer = Buffer.allocUnsafe(length);
    const descriptor = fs.openSync(filename, "r");
    try {
      fs.readSync(descriptor, buffer, 0, length, previous.offset);
    } finally {
      fs.closeSync(descriptor);
    }
    previous.offset = stat.size;
    const lines = (previous.carry + buffer.toString("utf8")).split(/\r?\n/);
    previous.carry = lines.pop() ?? "";
    for (const line of lines) {
      const match = line.match(/FULLTIME_CLIPBOARD_REQUEST ([0-9]+) ([0-9]+)/);
      if (match) onClipboardRequest(match[1], match[2]);
      const joined = line.match(/FULLTIME_SHOWCASE_JOINED ([0-9]+)/);
      if (joined) onJoined(joined[1]);
    }
    state.set(filename, previous);
  }
}

function writeCheckpoint(filename, resultPath, deviceID, completed) {
  const temporary = `${filename}.${process.pid}.tmp`;
  const checkpoint = {
    schemaVersion: 1,
    kind: "fulltime.physical-ios-showcase-checkpoint",
    deviceID,
    resultBundle: path.basename(resultPath),
    completedFixtureIds: [...completed],
  };
  fs.writeFileSync(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filename);
}
