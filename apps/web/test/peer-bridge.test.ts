import assert from "node:assert/strict";
import test from "node:test";

import {
  isBoundedPeerJson,
  isPeerBridgeConfig,
  isPeerBridgeEvent,
  isPeerRequestAction,
  isPeerRequestEnvelope,
  isPeerResponseEnvelope,
  isPeerRoomEvent,
  PEER_BRIDGE_LIMITS,
  PEER_ROOM_PROTOCOL_VERSION,
} from "../lib/data/live/peer-bridge";

test("v2 bridge accepts projected room events and rejects malformed variants", () => {
  const version = PEER_ROOM_PROTOCOL_VERSION;
  assert.equal(isPeerRoomEvent({
    version,
    type: "bridge.ready",
    mode: "pear-p2p-rooms",
    at: 1,
  }), true);
  assert.equal(isPeerBridgeEvent({
    version,
    type: "transport.status",
    status: "discovering",
    peerCount: 3,
    at: 1,
  }), true);
  assert.equal(isPeerRoomEvent({
    version,
    type: "fixture.updated",
    fixtureId: "fixture-1",
    card: {
      fixture: {
        id: "fixture-1",
        competition: "World Cup",
        home: { id: "team-1", name: "Nigeria" },
        away: { id: "team-2", name: "Japan" },
        kickoff: 1_800_000_000_000,
        status: "scheduled",
      },
      phase: "upcoming",
      status: "scheduled",
      score: null,
      minute: null,
    },
    at: 1,
  }), true);
  assert.equal(isPeerRoomEvent({
    version,
    type: "room.state",
    roomId: "room_abc",
    revision: 12,
    state: { items: [], polls: [], members: [], typingUsers: [], unreadState: { count: 0, firstUnreadItemId: null, lastReadItemId: null, isAtLiveEdge: true } },
    at: 1,
  }), true);
  assert.equal(isPeerRoomEvent({
    version,
    type: "room.error",
    roomId: "room_abc",
    action: "room.join",
    code: "INVITE_REVOKED",
    message: "That invitation is no longer active.",
    recoverable: false,
    at: 1,
  }), true);

  assert.equal(isPeerRoomEvent({
    version,
    type: "room.state",
    roomId: "room_abc",
    revision: -1,
    state: {},
    at: 1,
  }), false);
  assert.equal(isPeerRoomEvent({
    version,
    type: "transport.status",
    status: "mystery",
    peerCount: 0,
    at: 1,
  }), false);
  assert.equal(isPeerRoomEvent({
    version,
    type: "room.error",
    action: "room.destroy-everything",
    code: "NOPE",
    message: "no",
    recoverable: false,
    at: 1,
  }), false);
});

test("v2 request and response envelopes remain correlated and JSON-only", () => {
  assert.equal(isPeerRequestAction("fixture.list"), true);
  assert.equal(isPeerRequestAction("room.message.send"), true);
  assert.equal(isPeerRequestAction("room.history.page"), true);
  assert.equal(isPeerRequestAction("room.thread.page"), true);
  assert.equal(isPeerRequestAction("fixture.intelligence"), true);
  assert.equal(isPeerRequestAction("record.get"), true);
  assert.equal(isPeerRequestAction("room.answer.submit"), true);
  assert.equal(isPeerRequestAction("room.receipt.get"), true);
  assert.equal(isPeerRequestAction("room.replay"), true);
  assert.equal(isPeerRequestAction("room.watch"), false);
  assert.equal(isPeerRequestAction("room.legacy.get"), false);
  assert.equal(isPeerRequestAction(""), false);
  assert.equal(isPeerRequestAction("room/escape"), false);
  assert.equal(isPeerRequestAction("room.destroy-everything"), false);

  const request = {
    version: PEER_ROOM_PROTOCOL_VERSION,
    id: "request-123",
    action: "room.message.send",
    payload: { roomId: "room_abc", input: { text: "hello" } },
  };
  assert.equal(isPeerRequestEnvelope(request), true);
  assert.equal(isPeerRequestEnvelope({ ...request, id: "x" }), false);
  assert.equal(isPeerRequestEnvelope({ ...request, extra: true }), false);
  assert.equal(isPeerRequestEnvelope({ ...request, payload: { value: undefined } }), false);

  assert.equal(isPeerResponseEnvelope({
    version: PEER_ROOM_PROTOCOL_VERSION,
    id: "request-123",
    ok: true,
    result: { id: "message_1" },
  }), true);
  assert.equal(isPeerResponseEnvelope({
    version: PEER_ROOM_PROTOCOL_VERSION,
    id: "request-123",
    ok: false,
    error: {
      code: "ATTESTOR_UNAVAILABLE",
      message: "Live calls need pinned attestor keys.",
      recoverable: true,
    },
  }), true);
  assert.equal(isPeerResponseEnvelope({
    version: PEER_ROOM_PROTOCOL_VERSION,
    id: "request-123",
    ok: false,
    error: {
      code: "NOT_A_MEMBER",
      message: "Join the room before posting.",
      recoverable: true,
      details: { roomId: "room_abc" },
    },
  }), true);
  assert.equal(isPeerResponseEnvelope({
    version: PEER_ROOM_PROTOCOL_VERSION,
    id: "request-123",
    ok: true,
  }), false);
  assert.equal(isPeerResponseEnvelope({
    version: PEER_ROOM_PROTOCOL_VERSION,
    id: "request-123",
    ok: false,
    error: { code: "NOPE", message: "no", recoverable: false, stack: "secret" },
  }), false);
});

test("renderer JSON validation bounds shape, depth, size, and prototypes", () => {
  assert.equal(isBoundedPeerJson(null), true);
  assert.equal(isBoundedPeerJson({ text: "hello", values: [1, true, null] }), true);
  assert.equal(isBoundedPeerJson(Number.NaN), false);
  assert.equal(isBoundedPeerJson({ missing: undefined }), false);
  assert.equal(isBoundedPeerJson(new Date()), false);

  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.equal(isBoundedPeerJson(cyclic), false);

  let deep: unknown = null;
  for (let index = 0; index <= PEER_BRIDGE_LIMITS.maxJsonDepth; index++) deep = [deep];
  assert.equal(isBoundedPeerJson(deep), false);
  assert.equal(isBoundedPeerJson("x".repeat(PEER_BRIDGE_LIMITS.maxStringLength + 1)), false);

  const polluted = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(polluted, "constructor", { enumerable: true, value: "blocked" });
  assert.equal(isBoundedPeerJson(polluted), false);

  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, "value", { enumerable: true, get: () => "not read" });
  assert.equal(isBoundedPeerJson(accessor), false);
});

test("bridge config accepts only the production Pear room host", () => {
  assert.equal(isPeerBridgeConfig({
    protocolVersion: PEER_ROOM_PROTOCOL_VERSION,
    mode: "pear-p2p-rooms",
    maxRoomMembers: 256,
    networkConfig: "stale",
  }), true);
  assert.equal(isPeerBridgeConfig({
    protocolVersion: PEER_ROOM_PROTOCOL_VERSION,
    mode: "pear-p2p-rooms",
    maxRoomMembers: 256,
    networkConfig: "fresh",
  }), false);
  assert.equal(isPeerBridgeConfig({
    protocolVersion: PEER_ROOM_PROTOCOL_VERSION,
    mode: "pear-p2p-rooms",
    maxRoomMembers: 257,
  }), false);
});
