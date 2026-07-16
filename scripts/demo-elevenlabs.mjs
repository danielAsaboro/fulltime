#!/usr/bin/env node
/**
 * Smoke ElevenLabs via BlockRun x402 (no ElevenLabs account).
 * Uses agentcash wallet. For the in-app path set ELEVENLABS_API_KEY on the web host.
 *
 *   node scripts/demo-elevenlabs.mjs
 *   node scripts/demo-elevenlabs.mjs "Goal for Brazil at 23 minutes"
 */

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const text = process.argv[2] || "Kickoff. FullTime match call-outs are live.";
const out = resolve(process.cwd(), "evidence", "elevenlabs-demo.mp3");

console.log("Synthesizing via BlockRun ElevenLabs gateway…");
console.log(`  text: ${text}`);

const result = spawnSync(
  "npx",
  [
    "agentcash@latest",
    "fetch",
    "https://blockrun.ai/api/v1/audio/speech",
    "-m",
    "POST",
    "-b",
    JSON.stringify({
      input: text,
      model: "elevenlabs/flash-v2.5",
      voice: "george",
      response_format: "mp3",
    }),
  ],
  { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
);

if (result.status !== 0) {
  console.error(result.stderr?.toString() || result.stdout?.toString() || "fetch failed");
  process.exit(result.status || 1);
}

const stdout = result.stdout;
// agentcash may print JSON metadata or raw audio; try to detect
if (stdout[0] === 0x7b /* { */) {
  const json = JSON.parse(stdout.toString("utf8"));
  if (json.error || json.success === false) {
    console.error(JSON.stringify(json, null, 2));
    process.exit(1);
  }
  // Some gateways return base64
  if (typeof json.data === "string") {
    writeFileSync(out, Buffer.from(json.data, "base64"));
  } else if (json.audio || json.url) {
    console.log("Response:", JSON.stringify(json, null, 2).slice(0, 500));
    console.log("Got structured response — check agentcash output format.");
    process.exit(0);
  } else {
    writeFileSync(out, stdout);
  }
} else {
  writeFileSync(out, stdout);
}

console.log(`Wrote ${out} (${stdout.length} bytes)`);
console.log("Play it, then set ELEVENLABS_API_KEY for in-app /api/tts call-outs.");
