#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const device = process.argv[2];
const roomsPath = path.resolve(process.argv[3] ?? "");
if (!device || !roomsPath) throw new Error("Usage: ios-verify-showcase.mjs <device> <rooms-json>");

const repoRoot = path.resolve(import.meta.dirname, "..");
const productsDir = path.join(repoRoot, "apps/mobile/.local-development/ios-ui-test-derived-data/Build/Products");
const dataRoot = path.join(repoRoot, "data/world-cup-2026");
const provisioned = JSON.parse(fs.readFileSync(roomsPath, "utf8"));
const labels = (provisioned.rooms ?? []).map((room) => {
  const directory = fs.readdirSync(dataRoot).find((entry) => entry.startsWith(`${room.fixtureId}-`));
  const seedPath = directory && path.join(dataRoot, directory, "room-seed.json");
  if (!seedPath || !fs.existsSync(seedPath)) throw new Error(`Room seed is unavailable for fixture ${room.fixtureId}`);
  const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const fixtureReference = seed.evidence?.fixture ?? "archive/fixture.json";
  const seedRelativeFixturePath = path.resolve(path.dirname(seedPath), fixtureReference);
  const fixturePath = fs.existsSync(seedRelativeFixturePath)
    ? seedRelativeFixturePath
    : path.resolve(repoRoot, fixtureReference);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  // RoomRow renders the persisted fixture subtitle with `vs`; the room name
  // itself is operator-authored and is not the stable identity assertion.
  return `${fixture.Participant1} vs ${fixture.Participant2}`;
});

const testRunName = fs.readdirSync(productsDir).find((name) => name.endsWith(".xctestrun"));
if (!testRunName) throw new Error("No iOS .xctestrun exists; build FullTime for testing first");
const privateTestRunPath = path.join(productsDir, `.fulltime-showcase-list-${process.pid}.xctestrun`);
fs.copyFileSync(path.join(productsDir, testRunName), privateTestRunPath, fs.constants.COPYFILE_EXCL);
fs.chmodSync(privateTestRunPath, 0o600);
const configured = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Add :FullTimeTests:EnvironmentVariables:FULLTIME_TEST_ROOM_LABELS string ${labels.join("|")}`, privateTestRunPath], { stdio: "pipe" });
if (configured.status !== 0) {
  fs.unlinkSync(privateTestRunPath);
  throw new Error("Could not configure private showcase room labels");
}

const evidenceRoot = path.join(repoRoot, "evidence/physical-e2e");
fs.mkdirSync(evidenceRoot, { recursive: true });
const resultPath = path.join(evidenceRoot, `ios-showcase-room-list-${Date.now()}.xcresult`);
let result;
try {
  result = spawnSync("xcodebuild", [
    "-quiet", "-xctestrun", privateTestRunPath,
    "-destination", `id=${device}`,
    "-resultBundlePath", resultPath,
    "-allowProvisioningUpdates", "test-without-building",
    "-only-testing:FullTimeTests/FullTimeUITests/testVerifyShowcaseRoomList",
  ], { cwd: repoRoot, stdio: "inherit" });
} finally {
  fs.unlinkSync(privateTestRunPath);
}
if (result.status !== 0) throw new Error(`iPhone showcase room-list verification failed; evidence: ${resultPath}`);
process.stdout.write(`Verified ${labels.length} accumulated iPhone showcase rooms; evidence: ${resultPath}\n`);
