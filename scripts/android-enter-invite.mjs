#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";

const device = process.argv[2];
const invitePath = process.argv[3];
if (!device || !invitePath) throw new Error("Usage: android-enter-invite.mjs <device> <invite-file>");
const invite = fs.readFileSync(invitePath, "utf8").trim();
if (!/^ft2\.[a-z0-9.]+$/.test(invite)) throw new Error("Invite file is not a canonical FullTime v2 code");

function adb(...args) {
  const result = spawnSync("adb", ["-s", device, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `adb ${args.join(" ")} failed`);
  return result.stdout;
}

function currentInput() {
  adb("shell", "uiautomator", "dump", "/sdcard/fulltime-e2e.xml");
  const hierarchy = adb("shell", "cat", "/sdcard/fulltime-e2e.xml");
  const node = [...hierarchy.matchAll(/<node[^>]+class="android\.widget\.EditText"[^>]+>/g)]
    .map((match) => match[0])
    .find((candidate) => candidate.includes("ft2.") || candidate.includes('text="Paste room invite"'));
  if (!node) throw new Error("Android invite input is not visible");
  const rawText = node.match(/\btext="([^"]*)"/)?.[1] ?? "";
  const text = rawText === "Paste room invite" ? "" : rawText;
  const bounds = node.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!bounds) throw new Error("Android invite input bounds are unavailable");
  return {
    text,
    x: Math.round((Number(bounds[1]) + Number(bounds[3])) / 2),
    y: Math.round((Number(bounds[2]) + Number(bounds[4])) / 2),
  };
}

let current = currentInput();
if (current.text) {
  adb("shell", "input", "tap", String(current.x), String(current.y));
  const clearCount = current.text.length + 8;
  for (const keyCode of ["67", "112"]) {
    for (let offset = 0; offset < clearCount; offset += 80) {
      adb("shell", "input", "keyevent", ...Array(Math.min(80, clearCount - offset)).fill(keyCode));
    }
  }
  current = currentInput();
  if (current.text) throw new Error(`Could not clear the Android invite input (remaining length ${current.text.length})`);
}
adb("shell", "input", "tap", String(current.x), String(current.y));

for (let offset = 0; offset < invite.length; offset += 120) {
  const chunk = invite.slice(offset, offset + 120);
  adb("shell", "input", "text", chunk);
  current = currentInput();
  const expectedLength = Math.min(offset + chunk.length, invite.length);
  if (current.text !== invite.slice(0, expectedLength)) {
    const expected = invite.slice(0, expectedLength);
    const mismatch = [...expected].findIndex((character, index) => current.text[index] !== character);
    throw new Error(`Android invite input diverged at ${mismatch} (actual length ${current.text.length}, expected ${expectedLength}/${invite.length})`);
  }
}

process.stdout.write(`Verified ${current.text.length}/${invite.length} invite characters on Android\n`);
