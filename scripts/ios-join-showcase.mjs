#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const device = process.argv[2];
const roomsPath = path.resolve(process.argv[3] ?? "");
const fixtureId = process.argv[4];
if (!device || !roomsPath || !fixtureId) {
  throw new Error("Usage: ios-join-showcase.mjs <device> <rooms-json> <fixture-id>");
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const productsDir = path.join(repoRoot, "apps/mobile/.local-development/ios-ui-test-derived-data/Build/Products");
const provisioned = JSON.parse(fs.readFileSync(roomsPath, "utf8"));
const room = (provisioned.rooms ?? []).find((candidate) => String(candidate.fixtureId) === String(fixtureId));
if (!room || typeof room.inviteCode !== "string" || !/^ft2\.[a-z0-9.]+$/.test(room.inviteCode)) {
  throw new Error(`Provisioned room invite is unavailable for fixture ${fixtureId}`);
}

const dataRoot = path.join(repoRoot, "data/world-cup-2026");
const directory = fs.readdirSync(dataRoot).find((entry) => entry.startsWith(`${fixtureId}-`));
const seedPath = directory && path.join(dataRoot, directory, "room-seed.json");
if (!seedPath || !fs.existsSync(seedPath)) throw new Error(`Room seed evidence is unavailable for ${fixtureId}`);
const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const fixturePath = path.resolve(path.dirname(seedPath), seed.evidence?.fixture ?? "archive/fixture.json");
if (!fs.existsSync(fixturePath)) throw new Error(`Verified archive fixture is unavailable for ${fixtureId}`);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
if (String(fixture.FixtureId) !== String(fixtureId) || !fixture.Participant1 || !fixture.Participant2) {
  throw new Error(`Verified archive identity does not match fixture ${fixtureId}`);
}

const testRunName = fs.readdirSync(productsDir).find((name) => name.endsWith(".xctestrun"));
if (!testRunName) throw new Error("No iOS .xctestrun exists; build FullTime for testing first");
const privateTestRunPath = path.join(productsDir, `.fulltime-showcase-${process.pid}.xctestrun`);
fs.copyFileSync(path.join(productsDir, testRunName), privateTestRunPath, fs.constants.COPYFILE_EXCL);
fs.chmodSync(privateTestRunPath, 0o600);

for (const [name, value] of [
  ["FULLTIME_TEST_INVITE", room.inviteCode],
  ["FULLTIME_TEST_FIXTURE_ID", String(fixtureId)],
  ["FULLTIME_TEST_PARTICIPANT_1", fixture.Participant1],
  ["FULLTIME_TEST_PARTICIPANT_2", fixture.Participant2],
]) {
  const configured = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Add :FullTimeTests:EnvironmentVariables:${name} string ${value}`, privateTestRunPath], { stdio: "pipe" });
  if (configured.status !== 0) {
    fs.unlinkSync(privateTestRunPath);
    throw new Error(`Could not configure private XCTest value ${name}`);
  }
}

const evidenceRoot = path.join(repoRoot, "evidence/physical-e2e");
fs.mkdirSync(evidenceRoot, { recursive: true });
const resultPath = path.join(evidenceRoot, `ios-showcase-${fixtureId}-${Date.now()}.xcresult`);
let result;
try {
  result = spawnSync("xcodebuild", [
    "-quiet",
    "-xctestrun", privateTestRunPath,
    "-destination", `id=${device}`,
    "-resultBundlePath", resultPath,
    "-allowProvisioningUpdates",
    "test-without-building",
    "-only-testing:FullTimeTests/FullTimeUITests/testJoinShowcaseRoom",
  ], { cwd: repoRoot, stdio: "inherit" });
} finally {
  fs.unlinkSync(privateTestRunPath);
}

if (result.status !== 0) throw new Error(`iPhone showcase join failed for fixture ${fixtureId}; evidence: ${resultPath}`);
process.stdout.write(`Verified iPhone showcase room ${fixtureId}; evidence: ${resultPath}\n`);
