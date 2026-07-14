/** Browser contract for the sandboxed Pear desktop preload bridge. */

import type {
  ChatMessage,
  AttachMarketReferenceInput,
  CreatePollInput,
  CreateRoomInput,
  FixtureCard,
  FixtureIntelligence,
  FixturesFilter,
  InviteView,
  ModerationReportReason,
  ModerationReportView,
  PollFeedItem,
  RoomCursorPage,
  RoomDetailsView,
  RoomFeedItem,
  RoomLiveState,
  RoomReceiptView,
  RoomReplay,
  RoomModerationTarget,
  RoomNotificationSettings,
  RoomPageOptions,
  RoomView,
  SendMessageInput,
  SendReplyInput,
  Session,
  ThreadReply,
  LocalRecordView,
} from "../types";

export const PEER_ROOM_PROTOCOL_VERSION = 2 as const;

export const PEER_BRIDGE_LIMITS = Object.freeze({
  maxActionLength: 80,
  maxRequestIdLength: 128,
  maxIdentifierLength: 256,
  maxJsonBytes: 2 * 1024 * 1024,
  maxJsonDepth: 12,
  maxJsonNodes: 20_000,
  maxArrayItems: 4_096,
  maxObjectKeys: 1_024,
  maxStringLength: 512 * 1024,
});

export type PeerJsonPrimitive = null | boolean | number | string;
export type PeerJsonValue = PeerJsonPrimitive | PeerJsonValue[] | { [key: string]: PeerJsonValue };

export interface PeerBridgeConfig {
  protocolVersion: typeof PEER_ROOM_PROTOCOL_VERSION;
  mode: "pear-p2p-rooms";
  maxRoomMembers: number;
  /** A previously verified manifest is in use while the desktop is offline. */
  networkConfig?: "stale";
}

export interface PeerRoomRequestMap {
  "fixture.list": { payload: FixturesFilter; result: FixtureCard[] };
  "fixture.get": { payload: { fixtureId: string }; result: FixtureCard | null };
  "fixture.intelligence": { payload: { fixtureId: string }; result: FixtureIntelligence | null };
  "record.get": { payload: null; result: LocalRecordView };

  "session.get": { payload: null; result: Session | null };
  "session.sign-in": { payload: { displayName: string }; result: Session };
  "session.sign-out": { payload: null; result: null };

  "room.list": { payload: null; result: RoomView[] };
  "room.get": { payload: { roomId: string }; result: RoomView | null };
  "room.preview-invite": { payload: { code: string }; result: RoomView | null };
  "room.create": { payload: CreateRoomInput; result: RoomDetailsView };
  "room.join": { payload: { code: string }; result: RoomView };
  "room.details": { payload: { roomId: string }; result: RoomDetailsView | null };
  "room.state": { payload: { roomId: string }; result: RoomLiveState };
  "room.answer.submit": { payload: { roomId: string; callId: string; optionId: string }; result: RoomReceiptView };
  "room.receipt.get": { payload: { roomId: string; receiptId: string }; result: RoomReceiptView };
  "room.replay": { payload: { roomId: string }; result: RoomReplay };
  "room.history.page": {
    payload: { roomId: string } & RoomPageOptions;
    result: RoomCursorPage<RoomFeedItem>;
  };
  "room.thread.page": {
    payload: { roomId: string; itemId: string } & RoomPageOptions;
    result: RoomCursorPage<ThreadReply>;
  };

  "room.poll.vote": { payload: { roomId: string; pollId: string; option: string }; result: null };
  "room.message.send": { payload: { roomId: string; input: SendMessageInput }; result: ChatMessage };
  "room.media.upload.begin": {
    payload: { roomId: string; name: string; sizeBytes: number };
    result: { uploadId: string; chunkBytes: number };
  };
  "room.media.upload.chunk": {
    payload: { roomId: string; uploadId: string; index: number; data: string };
    result: { receivedBytes: number; nextIndex: number };
  };
  "room.media.upload.commit": {
    payload: { roomId: string; uploadId: string; text: string };
    result: ChatMessage;
  };
  "room.media.upload.abort": { payload: { roomId: string; uploadId: string }; result: null };
  "room.media.download.begin": {
    payload: { roomId: string; itemId: string };
    result: { downloadId: string; name: string; mimeType: string; sizeBytes: number; chunkBytes: number; chunks: number };
  };
  "room.media.download.chunk": {
    payload: { roomId: string; downloadId: string; index: number };
    result: { index: number; data: string; hasMore: boolean };
  };
  "room.media.download.close": { payload: { roomId: string; downloadId: string }; result: null };
  "room.notification.settings": { payload: { roomId: string }; result: RoomNotificationSettings };
  "room.notification.settings.update": {
    payload: { roomId: string; settings: Partial<RoomNotificationSettings> };
    result: RoomNotificationSettings;
  };
  "room.report": {
    payload: { roomId: string; target: RoomModerationTarget; reason: ModerationReportReason; note: string };
    result: { reportId: string };
  };
  "room.reports.list": { payload: { roomId: string }; result: ModerationReportView[] };
  "room.poll.create": { payload: { roomId: string; input: CreatePollInput }; result: PollFeedItem };
  "room.market.reference": { payload: { roomId: string; input: AttachMarketReferenceInput }; result: PollFeedItem };
  "room.item.react": { payload: { roomId: string; itemId: string; emoji: string }; result: null };
  "room.reply.send": {
    payload: { roomId: string; itemId: string; input: SendReplyInput };
    result: ThreadReply;
  };
  "room.typing.set": { payload: { roomId: string; typing: boolean }; result: null };
  "room.read.mark": { payload: { roomId: string; itemId: string }; result: null };

  "room.invite.create": { payload: { roomId: string }; result: InviteView };
  "room.invite.regenerate": { payload: { roomId: string }; result: InviteView };
  "room.invite.revoke": { payload: { roomId: string }; result: null };
  "room.rename": { payload: { roomId: string; name: string }; result: null };
  "room.member.remove": { payload: { roomId: string; userId: string }; result: null };
  "room.member.role": {
    payload: { roomId: string; userId: string; role: "member" | "moderator" };
    result: null;
  };
  "room.slow-mode": { payload: { roomId: string; seconds: number }; result: null };
  "room.close": { payload: { roomId: string }; result: null };
  "room.leave": { payload: { roomId: string }; result: null };
}

export type PeerRequestAction = keyof PeerRoomRequestMap;
export type PeerRequestPayload<A extends PeerRequestAction> = PeerRoomRequestMap[A]["payload"];
export type PeerRequestResult<A extends PeerRequestAction> = PeerRoomRequestMap[A]["result"];

export interface PeerRequestEnvelope<A extends PeerRequestAction = PeerRequestAction> {
  version: typeof PEER_ROOM_PROTOCOL_VERSION;
  id: string;
  action: A;
  payload: PeerRequestPayload<A>;
}

export interface PeerBridgeError {
  code: string;
  message: string;
  recoverable: boolean;
  details?: PeerJsonValue;
}

export type PeerResponseEnvelope =
  | { version: typeof PEER_ROOM_PROTOCOL_VERSION; id: string; ok: true; result: PeerJsonValue }
  | { version: typeof PEER_ROOM_PROTOCOL_VERSION; id: string; ok: false; error: PeerBridgeError };

export type PeerRoomEvent =
  | {
      version: typeof PEER_ROOM_PROTOCOL_VERSION;
      type: "bridge.ready";
      mode: "pear-p2p-rooms";
      at: number;
    }
  | {
      version: typeof PEER_ROOM_PROTOCOL_VERSION;
      type: "transport.status";
      status: "starting" | "discovering" | "online" | "offline" | "degraded";
      peerCount: number;
      at: number;
    }
  | {
      version: typeof PEER_ROOM_PROTOCOL_VERSION;
      type: "fixture.updated";
      fixtureId: string;
      card: FixtureCard;
      at: number;
    }
  | {
      version: typeof PEER_ROOM_PROTOCOL_VERSION;
      type: "room.state";
      roomId: string;
      revision: number;
      state: RoomLiveState;
      at: number;
    }
  | {
      version: typeof PEER_ROOM_PROTOCOL_VERSION;
      type: "room.details";
      roomId: string;
      revision: number;
      details: RoomDetailsView;
      at: number;
    }
  | {
      version: typeof PEER_ROOM_PROTOCOL_VERSION;
      type: "room.error";
      roomId?: string;
      action?: PeerRequestAction;
      code: string;
      message: string;
      recoverable: boolean;
      at: number;
    };

export type PeerBridgeEvent = PeerRoomEvent;

export interface FullTimePeersBridge {
  resetIdentity?(): Promise<void>;
  getConfig(): Promise<PeerBridgeConfig>;
  request<A extends PeerRequestAction>(
    action: A,
    payload: PeerRequestPayload<A>,
  ): Promise<PeerRequestResult<A>>;
  subscribe(listener: (event: PeerBridgeEvent) => void): () => void;
}

const REQUEST_ACTIONS: ReadonlySet<string> = new Set<PeerRequestAction>([
  "fixture.list",
  "fixture.get",
  "fixture.intelligence",
  "record.get",
  "session.get",
  "session.sign-in",
  "session.sign-out",
  "room.list",
  "room.get",
  "room.preview-invite",
  "room.create",
  "room.join",
  "room.details",
  "room.state",
  "room.answer.submit",
  "room.receipt.get",
  "room.replay",
  "room.history.page",
  "room.thread.page",
  "room.poll.vote",
  "room.message.send",
  "room.media.upload.begin",
  "room.media.upload.chunk",
  "room.media.upload.commit",
  "room.media.upload.abort",
  "room.media.download.begin",
  "room.media.download.chunk",
  "room.media.download.close",
  "room.notification.settings",
  "room.notification.settings.update",
  "room.report",
  "room.reports.list",
  "room.poll.create",
  "room.market.reference",
  "room.item.react",
  "room.reply.send",
  "room.typing.set",
  "room.read.mark",
  "room.invite.create",
  "room.invite.regenerate",
  "room.invite.revoke",
  "room.rename",
  "room.member.remove",
  "room.member.role",
  "room.slow-mode",
  "room.close",
  "room.leave",
]);

const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const textEncoder = new TextEncoder();

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPlausibleTransportTimestamp(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && Number(value) <= Date.now() + 5 * 60_000;
}

function isBoundedString(
  value: unknown,
  maxLength: number = PEER_BRIDGE_LIMITS.maxIdentifierLength,
): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length <= allowed.length && keys.every((key) => allowed.includes(key));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Reject cycles, accessors, exotic prototypes, unsafe values, and oversized JSON. */
export function isBoundedPeerJson(value: unknown): value is PeerJsonValue {
  let nodes = 0;
  const ancestors = new WeakSet<object>();

  function visit(candidate: unknown, depth: number): boolean {
    nodes++;
    if (nodes > PEER_BRIDGE_LIMITS.maxJsonNodes || depth > PEER_BRIDGE_LIMITS.maxJsonDepth) return false;
    if (candidate === null || typeof candidate === "boolean") return true;
    if (typeof candidate === "number") return Number.isFinite(candidate);
    if (typeof candidate === "string") return candidate.length <= PEER_BRIDGE_LIMITS.maxStringLength;
    if (!candidate || typeof candidate !== "object" || ancestors.has(candidate)) return false;

    ancestors.add(candidate);
    let valid = true;
    if (Array.isArray(candidate)) {
      valid = candidate.length <= PEER_BRIDGE_LIMITS.maxArrayItems
        && candidate.every((item) => visit(item, depth + 1));
    } else if (isPlainRecord(candidate)) {
      if (Object.getOwnPropertySymbols(candidate).length > 0) valid = false;
      const descriptors = Object.getOwnPropertyDescriptors(candidate);
      const keys = Object.keys(descriptors);
      if (keys.length > PEER_BRIDGE_LIMITS.maxObjectKeys) valid = false;
      for (const key of keys) {
        const descriptor = descriptors[key];
        if (
          !valid
          || FORBIDDEN_OBJECT_KEYS.has(key)
          || key.length === 0
          || key.length > PEER_BRIDGE_LIMITS.maxIdentifierLength
          || !("value" in descriptor)
          || !descriptor.enumerable
          || !visit(descriptor.value, depth + 1)
        ) {
          valid = false;
          break;
        }
      }
    } else {
      valid = false;
    }
    ancestors.delete(candidate);
    return valid;
  }

  if (!visit(value, 0)) return false;
  try {
    return textEncoder.encode(JSON.stringify(value)).byteLength <= PEER_BRIDGE_LIMITS.maxJsonBytes;
  } catch {
    return false;
  }
}

export function isPeerRequestAction(value: unknown): value is PeerRequestAction {
  return typeof value === "string"
    && value.length > 0
    && value.length <= PEER_BRIDGE_LIMITS.maxActionLength
    && /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value)
    && REQUEST_ACTIONS.has(value);
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 8
    && value.length <= PEER_BRIDGE_LIMITS.maxRequestIdLength
    && /^[A-Za-z0-9][A-Za-z0-9._:-]+$/.test(value);
}

export function isPeerRequestEnvelope(value: unknown): value is PeerRequestEnvelope {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["version", "id", "action", "payload"])) return false;
  return value.version === PEER_ROOM_PROTOCOL_VERSION
    && isRequestId(value.id)
    && isPeerRequestAction(value.action)
    && Object.hasOwn(value, "payload")
    && isBoundedPeerJson(value.payload);
}

function isPeerBridgeError(value: unknown): value is PeerBridgeError {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["code", "message", "recoverable", "details"])) return false;
  return isBoundedString(value.code, 80)
    && isBoundedString(value.message, 2_048)
    && typeof value.recoverable === "boolean"
    && (!Object.hasOwn(value, "details") || isBoundedPeerJson(value.details));
}

export function isPeerResponseEnvelope(value: unknown): value is PeerResponseEnvelope {
  if (!isPlainRecord(value) || value.version !== PEER_ROOM_PROTOCOL_VERSION || !isRequestId(value.id)) return false;
  if (value.ok === true) {
    return hasOnlyKeys(value, ["version", "id", "ok", "result"])
      && Object.hasOwn(value, "result")
      && isBoundedPeerJson(value.result);
  }
  if (value.ok === false) {
    return hasOnlyKeys(value, ["version", "id", "ok", "error"])
      && isPeerBridgeError(value.error);
  }
  return false;
}

export function isPeerBridgeConfig(value: unknown): value is PeerBridgeConfig {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ["protocolVersion", "mode", "maxRoomMembers", "networkConfig"])
    && value.protocolVersion === PEER_ROOM_PROTOCOL_VERSION
    && value.mode === "pear-p2p-rooms"
    && isNonNegativeSafeInteger(value.maxRoomMembers)
    && value.maxRoomMembers > 0
    && value.maxRoomMembers <= 256
    && (!Object.hasOwn(value, "networkConfig") || value.networkConfig === "stale");
}

export function isPeerRoomEvent(value: unknown): value is PeerRoomEvent {
  if (!isPlainRecord(value) || value.version !== PEER_ROOM_PROTOCOL_VERSION) return false;
  switch (value.type) {
    case "bridge.ready":
      return hasOnlyKeys(value, ["version", "type", "mode", "at"])
        && value.mode === "pear-p2p-rooms"
        && isPlausibleTransportTimestamp(value.at);
    case "transport.status":
      return hasOnlyKeys(value, ["version", "type", "status", "peerCount", "at"])
        && ["starting", "discovering", "online", "offline", "degraded"].includes(String(value.status))
        && isNonNegativeSafeInteger(value.peerCount)
        && isPlausibleTransportTimestamp(value.at);
    case "fixture.updated":
      return hasOnlyKeys(value, ["version", "type", "fixtureId", "card", "at"])
        && isBoundedString(value.fixtureId)
        && isPlainRecord(value.card)
        && isPlainRecord(value.card.fixture)
        && value.card.fixture.id === value.fixtureId
        && isBoundedPeerJson(value.card)
        && isPlausibleTransportTimestamp(value.at);
    case "room.state":
      return hasOnlyKeys(value, ["version", "type", "roomId", "revision", "state", "at"])
        && isBoundedString(value.roomId)
        && isNonNegativeSafeInteger(value.revision)
        && isPlainRecord(value.state)
        && isBoundedPeerJson(value.state)
        && isPlausibleTransportTimestamp(value.at);
    case "room.details":
      return hasOnlyKeys(value, ["version", "type", "roomId", "revision", "details", "at"])
        && isBoundedString(value.roomId)
        && isNonNegativeSafeInteger(value.revision)
        && isPlainRecord(value.details)
        && isBoundedPeerJson(value.details)
        && isPlausibleTransportTimestamp(value.at);
    case "room.error":
      return hasOnlyKeys(value, ["version", "type", "roomId", "action", "code", "message", "recoverable", "at"])
        && (!Object.hasOwn(value, "roomId") || isBoundedString(value.roomId))
        && (!Object.hasOwn(value, "action") || isPeerRequestAction(value.action))
        && isBoundedString(value.code, 80)
        && isBoundedString(value.message, 2_048)
        && typeof value.recoverable === "boolean"
        && isPlausibleTransportTimestamp(value.at);
    default:
      return false;
  }
}

export function isPeerBridgeEvent(value: unknown): value is PeerBridgeEvent {
  return isPeerRoomEvent(value);
}

declare global {
  interface Window {
    fullTimePeers?: FullTimePeersBridge;
  }
}

let localhostPeerBridge: FullTimePeersBridge | null = null;
let browserRequestCounter = 0;

function localhostPeerEndpoint(path: string): string {
  return "/api/peer" + path;
}

function localhostOriginHeaders(): HeadersInit {
  return { "x-fulltime-local-origin": window.location.origin };
}

function nextBrowserRequestId(): string {
  browserRequestCounter = (browserRequestCounter + 1) % Number.MAX_SAFE_INTEGER;
  return "web-" + Date.now().toString(36) + "-" + browserRequestCounter.toString(36);
}

function localhostPeerError(value: unknown, fallback: string): Error {
  if (isPlainRecord(value) && isPlainRecord(value.error)) {
    const message = value.error.message;
    const code = value.error.code;
    if (typeof message === "string" && message) {
      const error = new Error(message);
      if (typeof code === "string" && code) Object.assign(error, { code });
      return error;
    }
  }
  return new Error(fallback);
}

async function localhostPeerJson(response: Response, fallback: string): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(fallback);
  }
  if (!response.ok) throw localhostPeerError(body, fallback);
  return body;
}

class LocalhostPeerBridge implements FullTimePeersBridge {
  private config: Promise<PeerBridgeConfig> | null = null;

  getConfig(): Promise<PeerBridgeConfig> {
    if (!this.config) {
      this.config = fetch(localhostPeerEndpoint("/config"), {
        credentials: "include",
        cache: "no-store",
        headers: localhostOriginHeaders(),
      }).then(async (response) => {
        const body = await localhostPeerJson(response, "The local FullTime peer bridge is unavailable.");
        if (!isPeerBridgeConfig(body)) throw new Error("The local FullTime peer bridge returned an invalid configuration.");
        return body;
      }).catch((error) => {
        this.config = null;
        throw error;
      });
    }
    return this.config;
  }

  async request<A extends PeerRequestAction>(
    action: A,
    payload: PeerRequestPayload<A>,
  ): Promise<PeerRequestResult<A>> {
    if (!isPeerRequestAction(action)) throw new TypeError("Unknown or invalid peer action");
    if (!isBoundedPeerJson(payload)) throw new TypeError("Peer request payload must be bounded JSON");
    await this.getConfig();
    const id = nextBrowserRequestId();
    const body = await fetch(localhostPeerEndpoint("/request"), {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json", ...localhostOriginHeaders() },
      body: JSON.stringify({ version: PEER_ROOM_PROTOCOL_VERSION, id, action, payload }),
    }).then((response) => localhostPeerJson(response, "The local FullTime peer bridge rejected the room request."));
    if (!isPeerResponseEnvelope(body) || body.id !== id) {
      throw new Error("The local FullTime peer bridge returned an invalid room response.");
    }
    if (!body.ok) {
      const error = new Error(body.error.message);
      Object.assign(error, { code: body.error.code });
      throw error;
    }
    return body.result as PeerRequestResult<A>;
  }

  subscribe(listener: (event: PeerBridgeEvent) => void): () => void {
    if (typeof listener !== "function") throw new TypeError("subscribe requires a listener");
    let active = true;
    let cursor = 0;
    let abort: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const reconnect = () => {
      if (!active) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, 1_000);
    };
    const connect = async () => {
      try {
        await this.getConfig();
        if (!active) return;
        abort = new AbortController();
        const response = await fetch(localhostPeerEndpoint("/events"), {
          credentials: "include",
          cache: "no-store",
          headers: {
            ...localhostOriginHeaders(),
            "x-fulltime-last-event-id": String(cursor),
          },
          signal: abort.signal,
        });
        if (!response.ok || !response.body) {
          await localhostPeerJson(response, "The local FullTime peer event stream is unavailable.");
          throw new Error("The local FullTime peer event stream has no body.");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (active) {
          const next = await reader.read();
          if (next.done) break;
          buffer += decoder.decode(next.value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            consumeSseBlock(block, (id, event) => {
              cursor = Math.max(cursor, id);
              if (isPeerBridgeEvent(event)) listener(event);
            });
            boundary = buffer.indexOf("\n\n");
          }
        }
        await reader.cancel().catch(() => undefined);
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) reconnect();
        return;
      } finally {
        abort = null;
      }
      reconnect();
    };
    void connect();
    return () => {
      active = false;
      abort?.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }
}

function consumeSseBlock(block: string, onEvent: (id: number, event: unknown) => void): void {
  if (!block || block.startsWith(":")) return;
  let id: number | null = null;
  let type = "";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("id: ")) {
      const value = Number(line.slice(4));
      if (Number.isSafeInteger(value) && value >= 0) id = value;
    } else if (line.startsWith("event: ")) {
      type = line.slice(7);
    } else if (line.startsWith("data: ")) {
      data += line.slice(6);
    }
  }
  if (id === null || type !== "peer" || !data) return;
  try {
    onEvent(id, JSON.parse(data));
  } catch {
    // A malformed local-host event is ignored; request frames remain independently validated.
  }
}

function desktopBridge(rawBridge: FullTimePeersBridge): FullTimePeersBridge {
  return {
    async getConfig() {
      const config: unknown = await rawBridge.getConfig();
      if (!isPeerBridgeConfig(config)) throw new Error("The desktop host returned an invalid configuration");
      return config;
    },
    async request<A extends PeerRequestAction>(action: A, payload: PeerRequestPayload<A>) {
      if (!isPeerRequestAction(action)) throw new TypeError("Unknown or invalid peer action");
      if (!isBoundedPeerJson(payload)) throw new TypeError("Peer request payload must be bounded JSON");
      const result: unknown = await rawBridge.request(action, payload);
      if (!isBoundedPeerJson(result)) throw new Error("The desktop host returned an invalid peer result");
      return result as PeerRequestResult<A>;
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("subscribe requires a listener");
      let active = true;
      const unsubscribe = rawBridge.subscribe((event) => {
        if (active && isPeerBridgeEvent(event)) listener(event);
      });
      if (typeof unsubscribe !== "function") throw new Error("The desktop host returned an invalid unsubscribe handle");
      return () => {
        if (!active) return;
        active = false;
        unsubscribe();
      };
    },
  };
}

export function isDesktopPeerBridgeAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = window.fullTimePeers;
  if (!bridge) return false;
  return typeof bridge.getConfig === "function"
    && typeof bridge.request === "function"
    && typeof bridge.subscribe === "function";
}

export function getPeerBridge(): FullTimePeersBridge {
  if (typeof window === "undefined") throw new Error("The peer bridge is available only in a browser renderer");
  const rawBridge = window.fullTimePeers;
  if (rawBridge) {
    if (!isDesktopPeerBridgeAvailable()) throw new Error("The FullTime desktop bridge is incomplete");
    return desktopBridge(rawBridge);
  }
  if (!localhostPeerBridge) localhostPeerBridge = new LocalhostPeerBridge();
  return localhostPeerBridge;
}
