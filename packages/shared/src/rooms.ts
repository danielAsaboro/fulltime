/**
 * Rooms. One global room per fixture is provisioned from the fixtures loader;
 * private rooms are created via invite code and share the same match call feed
 * while scoping their own reactions, notes, polls, and leaderboard. Judge rooms
 * replay a recorded corpus through the same loop.
 */

import type { FixtureId, RoomId, UserId } from "./ids";
import type { WallClock } from "./time";

export type RoomType = "global" | "private" | "judge";

export type RoomMemberRole = "member" | "creator" | "moderator";

export interface Room {
  id: RoomId;
  fixtureId: FixtureId;
  type: RoomType;
  name: string;
  /** Present for private rooms; the shareable join secret. */
  inviteCode?: string;
  /** Present for private/judge rooms. Global rooms are system-provisioned. */
  createdBy?: UserId;
  createdAt: WallClock;
}

export interface RoomMember {
  roomId: RoomId;
  userId: UserId;
  displayName: string;
  role: RoomMemberRole;
  joinedAt: WallClock;
}
