#!/usr/bin/env node

import fs from "node:fs/promises";

const command = process.argv[2] ?? "inspect";
const targets = await (await fetch("http://127.0.0.1:9229/json/list")).json();
const target = targets.find((candidate) => candidate.type === "page" && candidate.url.includes("127.0.0.1"));
if (!target?.webSocketDebuggerUrl) throw new Error("FullTime desktop DevTools target is unavailable");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
}

let output;
if (command === "inspect") {
  output = await evaluate("document.body.innerText");
} else if (command === "request") {
  const action = process.argv[3];
  const payload = JSON.parse(process.argv[4] ?? "null");
  output = await evaluate(`window.fullTimePeers.request(${JSON.stringify(action)}, ${JSON.stringify(payload)})`);
} else if (command === "click") {
  const label = process.argv[3];
  output = await evaluate(`(() => {
    const label = ${JSON.stringify(label)}.toLowerCase();
    const candidates = [...document.querySelectorAll('button'), ...document.querySelectorAll('a')];
    const candidate = candidates.find((element) => element.textContent?.trim().toLowerCase() === label) ??
      candidates.find((element) => element.textContent?.trim().toLowerCase().includes(label));
    if (!candidate) throw new Error('No button or link contains: ' + label);
    candidate.click();
    return { tag: candidate.tagName, text: candidate.textContent?.trim(), href: candidate.getAttribute('href') };
  })()`);
} else if (command === "fill") {
  const placeholder = process.argv[3];
  const value = process.argv[4] ?? "";
  output = await evaluate(`(() => {
    const input = [...document.querySelectorAll('input,textarea')].find((element) => element.getAttribute('placeholder') === ${JSON.stringify(placeholder)});
    if (!input) throw new Error('No input has placeholder: ' + ${JSON.stringify(placeholder)});
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
} else if (command === "screenshot") {
  const filename = process.argv[3];
  if (!filename) throw new Error("Screenshot path is required");
  await send("Page.enable");
  const capture = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await fs.writeFile(filename, Buffer.from(capture.data, "base64"));
  output = { filename };
} else if (command === "save-invite") {
  const filename = process.argv[3];
  if (!filename) throw new Error("Invite output path is required");
  const rooms = await evaluate("window.fullTimePeers.request('room.list', null)");
  const room = rooms.at(-1);
  if (!room?.inviteCode || !room?.room?.id) throw new Error("Desktop room invite is unavailable");
  await fs.writeFile(filename, `${room.inviteCode}\n`, { mode: 0o600 });
  output = { filename, roomId: room.room.id, roomName: room.room.name };
} else if (command === "regenerate-invite-save") {
  const roomId = process.argv[3];
  const filename = process.argv[4];
  if (!roomId || !filename) throw new Error("Room id and invite output path are required");
  const invite = await evaluate(`window.fullTimePeers.request('room.invite.regenerate', ${JSON.stringify({ roomId })})`);
  if (!invite?.code) throw new Error("Regenerated desktop room invite is unavailable");
  await fs.writeFile(filename, `${invite.code}\n`, { mode: 0o600 });
  output = { filename, roomId, inviteId: invite.id, status: invite.status };
} else if (command === "join-invites") {
  const filename = process.argv[3];
  if (!filename) throw new Error("Provisioned rooms JSON path is required");
  const provisioned = JSON.parse(await fs.readFile(filename, "utf8"));
  if (!Array.isArray(provisioned.rooms) || provisioned.rooms.length === 0) {
    throw new Error("Provisioned rooms JSON contains no rooms");
  }
  const existing = await evaluate("window.fullTimePeers.request('room.list', null)");
  const joinedIds = new Set(existing.map((entry) => entry?.room?.id).filter(Boolean));
  const joined = [];
  const alreadyPresent = [];
  for (const room of provisioned.rooms) {
    if (typeof room.roomId !== "string" || typeof room.inviteCode !== "string") {
      throw new Error("Provisioned room entry is invalid");
    }
    if (joinedIds.has(room.roomId)) {
      alreadyPresent.push(room.roomId);
      continue;
    }
    const result = await evaluate(`window.fullTimePeers.request('room.join', ${JSON.stringify({ code: room.inviteCode })})`);
    const roomId = result?.room?.id ?? result?.roomId ?? result?.id;
    if (roomId !== room.roomId) throw new Error(`Desktop joined unexpected room for fixture ${room.fixtureId}`);
    joined.push({ fixtureId: room.fixtureId, roomId });
    joinedIds.add(roomId);
  }
  const verified = await evaluate("window.fullTimePeers.request('room.list', null)");
  const verifiedIds = new Set(verified.map((entry) => entry?.room?.id).filter(Boolean));
  const missing = provisioned.rooms.map((room) => room.roomId).filter((roomId) => !verifiedIds.has(roomId));
  if (missing.length) throw new Error(`Desktop room verification is missing ${missing.length} room(s)`);
  output = { joined, alreadyPresent, verifiedRoomCount: provisioned.rooms.length };
} else {
  throw new Error(`Unsupported command: ${command}`);
}

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
socket.close();
