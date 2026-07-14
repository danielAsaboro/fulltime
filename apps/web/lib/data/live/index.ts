/** Pear-backed implementation of the renderer data contract. */

import type {
  ChatMessage,
  CreatePollInput,
  CreateRoomInput,
  FixtureCard,
  FixtureIntelligence,
  FixturesFilter,
  FullTimeData,
  InviteView,
  ModerationReportReason,
  ModerationReportView,
  PollFeedItem,
  RoomCursorPage,
  RoomDetailsView,
  RoomFeedItem,
  RoomLiveState,
  RoomMediaDownload,
  RoomModerationTarget,
  RoomNotificationSettings,
  RoomPageOptions,
  RoomView,
  RoomReceiptView,
  RoomReplay,
  LocalRecordView,
  SendMessageInput,
  SendReplyInput,
  Session,
  ThreadReply,
} from "../types";
import { getPeerBridge } from "./peer-bridge";

export class LiveDataClient implements FullTimeData {
  async listFixtures(filter: FixturesFilter = {}): Promise<FixtureCard[]> {
    return getPeerBridge().request("fixture.list", filter);
  }

  async getFixtureCard(fixtureId: string): Promise<FixtureCard | null> {
    return getPeerBridge().request("fixture.get", { fixtureId });
  }

  async getFixtureIntelligence(fixtureId: string): Promise<FixtureIntelligence | null> {
    return getPeerBridge().request("fixture.intelligence", { fixtureId });
  }

  subscribeFixtures(onFixture: (card: FixtureCard) => void): () => void {
    return getPeerBridge().subscribe((event) => {
      if (event.version === 2 && event.type === "fixture.updated") onFixture(event.card);
    });
  }

  async listRooms(): Promise<RoomView[]> {
    return getPeerBridge().request("room.list", null);
  }

  async getRoom(roomId: string): Promise<RoomView | null> {
    return getPeerBridge().request("room.get", { roomId });
  }

  async getRoomByInvite(code: string): Promise<RoomView | null> {
    return getPeerBridge().request("room.preview-invite", { code });
  }

  async createRoom(input: CreateRoomInput): Promise<RoomDetailsView> {
    return getPeerBridge().request("room.create", input);
  }

  async joinRoom(code: string): Promise<RoomView> {
    return getPeerBridge().request("room.join", { code });
  }

  async getRoomDetails(roomId: string): Promise<RoomDetailsView | null> {
    return getPeerBridge().request("room.details", { roomId });
  }

  async getRoomState(roomId: string): Promise<RoomLiveState> {
    return getPeerBridge().request("room.state", { roomId });
  }

  async submitAnswer(roomId: string, callId: string, optionId: string): Promise<RoomReceiptView> {
    return getPeerBridge().request("room.answer.submit", { roomId, callId, optionId });
  }

  async getRoomReceipt(roomId: string, receiptId: string): Promise<RoomReceiptView> {
    return getPeerBridge().request("room.receipt.get", { roomId, receiptId });
  }

  async getRoomReplay(roomId: string): Promise<RoomReplay> {
    return getPeerBridge().request("room.replay", { roomId });
  }

  async getRecord(): Promise<LocalRecordView> {
    return getPeerBridge().request("record.get", null);
  }

  subscribeRoomState(roomId: string, onState: (state: RoomLiveState) => void): () => void {
    return getPeerBridge().subscribe((event) => {
      if (event.version === 2 && event.type === "room.state" && event.roomId === roomId) {
        onState(event.state);
      }
    });
  }

  async getRoomHistoryPage(
    roomId: string,
    options: RoomPageOptions = {},
  ): Promise<RoomCursorPage<RoomFeedItem>> {
    return getPeerBridge().request("room.history.page", pagePayload({ roomId }, options));
  }

  async getRoomThreadPage(
    roomId: string,
    itemId: string,
    options: RoomPageOptions = {},
  ): Promise<RoomCursorPage<ThreadReply>> {
    return getPeerBridge().request("room.thread.page", pagePayload({ roomId, itemId }, options));
  }

  async votePoll(roomId: string, pollId: string, option: string): Promise<void> {
    await getPeerBridge().request("room.poll.vote", { roomId, pollId, option });
  }

  async sendMessage(roomId: string, input: SendMessageInput): Promise<ChatMessage> {
    return getPeerBridge().request("room.message.send", { roomId, input });
  }

  async uploadAttachment(roomId: string, file: File, text: string): Promise<ChatMessage> {
    if (!file || typeof file.name !== "string" || !Number.isSafeInteger(file.size) || file.size < 1) {
      throw new TypeError("Choose a non-empty file to attach.");
    }
    if (typeof file.stream !== "function") throw new TypeError("The selected file cannot be read safely.");
    const bridge = getPeerBridge();
    const started = await bridge.request("room.media.upload.begin", {
      roomId,
      name: file.name,
      sizeBytes: file.size,
    });
    let committed = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      reader = file.stream().getReader();
      let index = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        if (!(next.value instanceof Uint8Array)) throw new TypeError("The selected file returned invalid bytes.");
        for (let offset = 0; offset < next.value.byteLength; offset += started.chunkBytes) {
          const chunk = next.value.subarray(offset, Math.min(next.value.byteLength, offset + started.chunkBytes));
          await bridge.request("room.media.upload.chunk", {
            roomId,
            uploadId: started.uploadId,
            index,
            data: base64UrlEncode(chunk),
          });
          index++;
        }
      }
      const message = await bridge.request("room.media.upload.commit", {
        roomId,
        uploadId: started.uploadId,
        text,
      });
      committed = true;
      return message;
    } finally {
      reader?.releaseLock();
      if (!committed) {
        await bridge.request("room.media.upload.abort", { roomId, uploadId: started.uploadId }).catch(() => undefined);
      }
    }
  }

  async downloadAttachment(roomId: string, itemId: string): Promise<RoomMediaDownload> {
    const bridge = getPeerBridge();
    const started = await bridge.request("room.media.download.begin", { roomId, itemId });
    if (!isRoomMediaMime(started.mimeType) || !Number.isSafeInteger(started.sizeBytes) || started.sizeBytes < 1 ||
        !Number.isSafeInteger(started.chunks) || started.chunks < 1) {
      throw new Error("The encrypted attachment metadata is invalid.");
    }
    const output = new Uint8Array(started.sizeBytes);
    let offset = 0;
    let index = 0;
    let complete = false;
    try {
      while (true) {
        const chunk = await bridge.request("room.media.download.chunk", {
          roomId,
          downloadId: started.downloadId,
          index,
        });
        if (chunk.index !== index) throw new Error("The encrypted attachment returned chunks out of order.");
        const bytes = base64UrlDecode(chunk.data);
        if (!bytes.byteLength || bytes.byteLength > started.chunkBytes || offset + bytes.byteLength > output.byteLength) {
          bytes.fill(0);
          throw new Error("The encrypted attachment returned an invalid chunk.");
        }
        output.set(bytes, offset);
        bytes.fill(0);
        offset += bytes.byteLength;
        index++;
        if (!chunk.hasMore) {
          complete = true;
          break;
        }
      }
      if (offset !== output.byteLength || index !== started.chunks) {
        throw new Error("The encrypted attachment ended at an invalid byte length.");
      }
      return { name: started.name, mimeType: started.mimeType, bytes: output };
    } catch (error) {
      output.fill(0);
      throw error;
    } finally {
      if (!complete) {
        await bridge.request("room.media.download.close", { roomId, downloadId: started.downloadId }).catch(() => undefined);
      }
    }
  }

  async getNotificationSettings(roomId: string): Promise<RoomNotificationSettings> {
    return getPeerBridge().request("room.notification.settings", { roomId });
  }

  async updateNotificationSettings(
    roomId: string,
    settings: Partial<RoomNotificationSettings>,
  ): Promise<RoomNotificationSettings> {
    return getPeerBridge().request("room.notification.settings.update", { roomId, settings });
  }

  async reportRoomTarget(
    roomId: string,
    target: RoomModerationTarget,
    reason: ModerationReportReason,
    note: string,
  ): Promise<{ reportId: string }> {
    return getPeerBridge().request("room.report", { roomId, target, reason, note });
  }

  async listModerationReports(roomId: string): Promise<ModerationReportView[]> {
    return getPeerBridge().request("room.reports.list", { roomId });
  }

  async createPoll(roomId: string, input: CreatePollInput): Promise<PollFeedItem> {
    return getPeerBridge().request("room.poll.create", { roomId, input });
  }

  async attachMarketReference(roomId: string, input: import("../types").AttachMarketReferenceInput): Promise<PollFeedItem> {
    return getPeerBridge().request("room.market.reference", { roomId, input });
  }

  async reactToItem(roomId: string, itemId: string, emoji: string): Promise<void> {
    await getPeerBridge().request("room.item.react", { roomId, itemId, emoji });
  }

  async sendReply(roomId: string, itemId: string, input: SendReplyInput): Promise<ThreadReply> {
    return getPeerBridge().request("room.reply.send", { roomId, itemId, input });
  }

  async setTyping(roomId: string, typing: boolean): Promise<void> {
    await getPeerBridge().request("room.typing.set", { roomId, typing });
  }

  async markRoomRead(roomId: string, itemId: string): Promise<void> {
    await getPeerBridge().request("room.read.mark", { roomId, itemId });
  }

  async createInvite(roomId: string): Promise<InviteView> {
    return getPeerBridge().request("room.invite.create", { roomId });
  }

  async regenerateInvite(roomId: string): Promise<InviteView> {
    return getPeerBridge().request("room.invite.regenerate", { roomId });
  }

  async revokeInvite(roomId: string): Promise<void> {
    await getPeerBridge().request("room.invite.revoke", { roomId });
  }

  async renameRoom(roomId: string, name: string): Promise<void> {
    await getPeerBridge().request("room.rename", { roomId, name });
  }

  async removeMember(roomId: string, userId: string): Promise<void> {
    await getPeerBridge().request("room.member.remove", { roomId, userId });
  }

  async setMemberRole(roomId: string, userId: string, role: "member" | "moderator"): Promise<void> {
    await getPeerBridge().request("room.member.role", { roomId, userId, role });
  }

  async setSlowMode(roomId: string, seconds: number): Promise<void> {
    await getPeerBridge().request("room.slow-mode", { roomId, seconds });
  }

  async closeRoom(roomId: string): Promise<void> {
    await getPeerBridge().request("room.close", { roomId });
  }

  async leaveRoom(roomId: string): Promise<void> {
    await getPeerBridge().request("room.leave", { roomId });
  }

  async getSession(): Promise<Session | null> {
    return getPeerBridge().request("session.get", null);
  }

  async signIn(displayName: string): Promise<Session> {
    return getPeerBridge().request("session.sign-in", { displayName });
  }

  async signOut(): Promise<void> {
    await getPeerBridge().request("session.sign-out", null);
  }
}

function pagePayload<T extends { roomId: string }>(
  base: T,
  options: RoomPageOptions,
): T & RoomPageOptions {
  return {
    ...base,
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
  };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.byteLength, offset + 0x8000)));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Attachment chunk is not canonical base64url.");
  const padded = `${value}${"=".repeat((4 - value.length % 4) % 4)}`;
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("Attachment chunk is not valid base64url.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  if (base64UrlEncode(bytes) !== value) {
    bytes.fill(0);
    throw new Error("Attachment chunk is not canonical base64url.");
  }
  return bytes;
}

function isRoomMediaMime(value: string): value is RoomMediaDownload["mimeType"] {
  return ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "text/plain"].includes(value);
}
