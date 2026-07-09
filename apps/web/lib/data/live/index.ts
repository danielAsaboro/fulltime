/**
 * Live adapter — STUBS for the backend engineer (Codex) to fill. Each method names
 * the Supabase table / realtime channel / worker bridge it should read or write.
 * Until wired, every method throws, so live mode renders the UI's error states
 * honestly rather than pretending. See BACKEND-REMAINING.md for the full checklist.
 *
 * Hard rule: this file is the ONLY place Supabase (or any transport) may be
 * imported. Components never see it.
 */

import type { CalibrationMethod } from "@fulltime/shared";

import type {
  CalibrationView,
  FanReportView,
  FixtureCard,
  FixturesFilter,
  FullTimeData,
  RecordView,
  ReceiptView,
  ReplayView,
  RoomLiveState,
  RoomView,
  Session,
} from "../types";

function notImplemented(method: string): never {
  throw new Error(`live.${method} not implemented — see BACKEND-REMAINING.md (TODO(codex))`);
}

export class LiveDataClient implements FullTimeData {
  // TODO(codex): read `fixtures` table (worker fixtures loader → DB bridge),
  // join the provisioned global `rooms`, compute phase from status. Filter by phase.
  async listFixtures(_filter?: FixturesFilter): Promise<FixtureCard[]> {
    return notImplemented("listFixtures");
  }

  // TODO(codex): select one fixture + its global room by fixtureId.
  async getFixtureCard(_fixtureId: string): Promise<FixtureCard | null> {
    return notImplemented("getFixtureCard");
  }

  // TODO(codex): read `rooms` + `room_members` count; join `fixtures`.
  async getRoom(_roomId: string): Promise<RoomView | null> {
    return notImplemented("getRoom");
  }

  // TODO(codex): resolve `rooms.invite_code` → room (private room join).
  async getRoomByInvite(_code: string): Promise<RoomView | null> {
    return notImplemented("getRoomByInvite");
  }

  // TODO(codex): hydrate room from `events`/`calls`/`answers`/`settlements`/
  // `receipts`/`market_says`/`polls`/`notes` + the viewer's scoring row.
  async getRoomState(_roomId: string): Promise<RoomLiveState> {
    return notImplemented("getRoomState");
  }

  // TODO(codex): subscribe to Supabase Realtime channel `room:{roomId}` (diff
  // payloads). Map each diff into a fresh RoomLiveState and call onState.
  // Return the channel unsubscribe.
  subscribeRoomState(_roomId: string, _onState: (s: RoomLiveState) => void): () => void {
    notImplemented("subscribeRoomState");
  }

  // TODO(codex): insert into `answers` (wall-clock + feed-time stamped, delay claim).
  async submitAnswer(_roomId: string, _callId: string, _option: string): Promise<void> {
    return notImplemented("submitAnswer");
  }

  // TODO(codex): insert into `reactions` anchored to the event; fan-out via realtime.
  async sendReaction(_roomId: string, _emoji: string, _anchorId: string): Promise<void> {
    return notImplemented("sendReaction");
  }

  // TODO(codex): insert into `notes` (<=120 chars, rate-limited) anchored to the moment.
  async sendNote(_roomId: string, _text: string, _anchorId: string): Promise<void> {
    return notImplemented("sendNote");
  }

  // TODO(codex): upsert `poll_votes`; return updated tally via realtime.
  async votePoll(_roomId: string, _pollId: string, _option: string): Promise<void> {
    return notImplemented("votePoll");
  }

  // TODO(codex): read `receipts` + linked proof artifact (stat-validation + anchor).
  async getReceipt(_receiptId: string): Promise<ReceiptView | null> {
    return notImplemented("getReceipt");
  }

  // TODO(codex): read `records`/`settlements` for this room+user → Fan Report.
  async getReport(_roomId: string): Promise<FanReportView | null> {
    return notImplemented("getReport");
  }

  // TODO(codex): read the tournament `records` for the signed-in user.
  async getRecord(): Promise<RecordView | null> {
    return notImplemented("getRecord");
  }

  // TODO(codex): read `replay_events` corpus for the fixture; build ordered beats.
  async getReplay(_fixtureId: string): Promise<ReplayView | null> {
    return notImplemented("getReplay");
  }

  // TODO(codex): read the SIWS session cookie/JWT → `users` row.
  async getSession(): Promise<Session | null> {
    return notImplemented("getSession");
  }

  // TODO(codex): SIWS challenge → wallet sign → server verify → session; upsert `users`.
  async signIn(_displayName: string): Promise<Session> {
    return notImplemented("signIn");
  }

  // TODO(codex): clear the SIWS session.
  async signOut(): Promise<void> {
    return notImplemented("signOut");
  }

  // TODO(codex): read `match_sync_profiles` for user+room.
  async getCalibration(_roomId: string): Promise<CalibrationView | null> {
    return notImplemented("getCalibration");
  }

  // TODO(codex): upsert `match_sync_profiles` (presentation-only; never settlement).
  async setCalibration(_roomId: string, _delaySeconds: number, _method: CalibrationMethod): Promise<void> {
    return notImplemented("setCalibration");
  }
}
