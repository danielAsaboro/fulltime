/**
 * Event-tied social layer. FullTime is reaction-first: every reaction, note, and
 * poll is anchored to a match moment (feed event, call, minute, odds swing, or
 * receipt) rather than floating in a generic feed. Anchoring carries the feed time
 * so the client release queue can hold social items until `feed_ts + D` too — the
 * room reacts at the right moment for each viewer.
 */

import type {
  CallId,
  MatchEventId,
  NoteId,
  PollId,
  ReactionId,
  ReceiptId,
  RoomId,
  UserId,
} from "./ids";
import type { FeedTimestamp, WallClock } from "./time";

export type SocialAnchor =
  | { kind: "match-event"; matchEventId: MatchEventId }
  | { kind: "call"; callId: CallId }
  | { kind: "minute"; minute: number }
  | { kind: "odds-swing"; feedTs: FeedTimestamp }
  | { kind: "receipt"; receiptId: ReceiptId };

export interface Reaction {
  id: ReactionId;
  roomId: RoomId;
  userId: UserId;
  emoji: string;
  anchor: SocialAnchor;
  /** Feed time of the anchored moment, for release scheduling. */
  feedTs: FeedTimestamp;
  createdAt: WallClock;
}

export const MAX_NOTE_LENGTH = 120;

export interface Note {
  id: NoteId;
  roomId: RoomId;
  userId: UserId;
  /** Capped at MAX_NOTE_LENGTH; public rooms are note-limited, private rooms richer. */
  text: string;
  anchor: SocialAnchor;
  feedTs: FeedTimestamp;
  createdAt: WallClock;
}

export interface PollOption {
  id: string;
  label: string;
  votes: number;
}

export interface Poll {
  id: PollId;
  roomId: RoomId;
  question: string;
  options: PollOption[];
  /** Social-only unless mapped to a deterministic settle; social polls give no Fan IQ. */
  scored: boolean;
  anchor?: SocialAnchor;
  createdAt: WallClock;
}

export interface PollVote {
  pollId: PollId;
  userId: UserId;
  option: string;
}
