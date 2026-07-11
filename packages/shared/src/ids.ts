/**
 * Branded identifier types.
 *
 * Branding stops a `FixtureId` from being passed where a `RoomId` is expected,
 * without any runtime cost. IDs we mint are created with the typed factories;
 * IDs that arrive from TxLINE (fixtures, feed messages) are branded on the way in
 * with the `as*` cast helpers so the boundary where trust changes stays visible.
 */

declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Brand<string, "UserId">;
export type RoomId = Brand<string, "RoomId">;
export type FixtureId = Brand<string, "FixtureId">;
export type MatchEventId = Brand<string, "MatchEventId">;
export type CallId = Brand<string, "CallId">;
export type AnswerId = Brand<string, "AnswerId">;
export type SettlementId = Brand<string, "SettlementId">;
export type ReceiptId = Brand<string, "ReceiptId">;
export type ReactionId = Brand<string, "ReactionId">;
export type NoteId = Brand<string, "NoteId">;
export type PollId = Brand<string, "PollId">;
export type RecordId = Brand<string, "RecordId">;
export type HighlightId = Brand<string, "HighlightId">;
/** Stable identifier for any item rendered in a room's unified feed. */
export type RoomItemId = Brand<string, "RoomItemId">;
/** Stable identifier for a user-authored message or thread reply. */
export type MessageId = Brand<string, "MessageId">;
/** Identifier for an invite generation. Codes may rotate; invite IDs never do. */
export type InviteId = Brand<string, "InviteId">;

/** Ordering key for a single TxLINE feed message (see `feed.ts`). */
export type FeedMessageId = Brand<string, "FeedMessageId">;

function uuid(): string {
  return globalThis.crypto.randomUUID();
}

function createId<B extends string>(prefix: string): Brand<string, B> {
  return `${prefix}_${uuid()}` as Brand<string, B>;
}

export const newRoomId = (): RoomId => createId("room");
export const newCallId = (): CallId => createId("call");
export const newAnswerId = (): AnswerId => createId("ans");
export const newSettlementId = (): SettlementId => createId("stl");
export const newReceiptId = (): ReceiptId => createId("rcpt");
export const newReactionId = (): ReactionId => createId("rxn");
export const newNoteId = (): NoteId => createId("note");
export const newPollId = (): PollId => createId("poll");
export const newRecordId = (): RecordId => createId("rec");
export const newHighlightId = (): HighlightId => createId("hl");
export const newRoomItemId = (): RoomItemId => createId("item");
export const newMessageId = (): MessageId => createId("msg");
export const newInviteId = (): InviteId => createId("inv");

export const asFixtureId = (raw: string): FixtureId => raw as FixtureId;
export const asUserId = (raw: string): UserId => raw as UserId;
export const asRoomId = (raw: string): RoomId => raw as RoomId;
export const asFeedMessageId = (raw: string): FeedMessageId => raw as FeedMessageId;
export const asMatchEventId = (raw: string): MatchEventId => raw as MatchEventId;
export const asCallId = (raw: string): CallId => raw as CallId;
export const asAnswerId = (raw: string): AnswerId => raw as AnswerId;
export const asSettlementId = (raw: string): SettlementId => raw as SettlementId;
export const asReceiptId = (raw: string): ReceiptId => raw as ReceiptId;
export const asRecordId = (raw: string): RecordId => raw as RecordId;
export const asRoomItemId = (raw: string): RoomItemId => raw as RoomItemId;
export const asMessageId = (raw: string): MessageId => raw as MessageId;
export const asInviteId = (raw: string): InviteId => raw as InviteId;
