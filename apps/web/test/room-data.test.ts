import assert from "node:assert/strict";
import { test } from "node:test";

import { asRoomItemId, asWallClock } from "@fulltime/shared";

import { orderRoomFeedItems, orderThreadReplies } from "../lib/data/room-feed";
import { MockDataClient } from "../lib/data/mock/index";
import { FM_KICKOFF_MS, FM_ROOM_ID } from "../lib/data/mock/corpus";
import type { RoomFeedItem } from "../lib/data/types";

test("mixed room items use spoiler-safe release time and stable ID ordering", async () => {
  const client = new MockDataClient();
  await client.signIn("Amina");
  client.jumpTo("fulltime");

  const state = await client.getRoomState(FM_ROOM_ID);
  const kinds = new Set(state.items.map((item) => item.kind));
  assert.deepEqual(
    [...kinds].sort(),
    ["call", "event", "image", "odds", "poll", "system", "text"],
  );
  assert.equal(state.items.some((item) => item.kind === "receipt"), false);
  assert.equal(state.receipts.length > 0, true);
  assert.deepEqual(state.items, orderRoomFeedItems(state.items));

  const source = state.items[0]!;
  const tied = orderRoomFeedItems([
    { ...source, id: asRoomItemId("item-b"), releaseAt: asWallClock(10) } as RoomFeedItem,
    { ...source, id: asRoomItemId("item-a"), releaseAt: asWallClock(10) } as RoomFeedItem,
  ]);
  assert.deepEqual(tied.map((item) => item.id), ["item-a", "item-b"]);
});

test("the guided demo restarts at pre-match with autoplay and a joined demo viewer", async () => {
  const client = new MockDataClient();
  client.jumpTo("fulltime");

  const entry = await client.enterDemoRoom();
  const state = await client.getRoomState(FM_ROOM_ID);

  assert.equal(entry.room.room.id, FM_ROOM_ID);
  assert.equal(entry.room.inviteCode, "AZZURRI");
  assert.equal(entry.session.displayName, "Demo Fan");
  assert.equal(client.scenarioLabel, "prematch");
  assert.equal(client.autoplayEnabled, true);
  assert.equal(state.phase, "upcoming");
  assert.equal(state.fixtureState.minute, null);
  assert.equal(
    state.members.some((member) => member.displayName === "Demo Fan" && member.isCurrentUser),
    true,
  );
  assert.equal(state.items.some((item) => item.kind === "text" && item.replies.length >= 3), true);
  assert.equal(state.items.some((item) => item.kind === "poll"), true);
  assert.equal(state.items.some((item) => item.kind === "image"), true);
  assert.equal(state.unreadState.count > 0, true);
  const joinNotice = state.items.find(
    (item) => item.kind === "system" && item.text.includes("Demo Fan joined"),
  );
  assert.ok(joinNotice && joinNotice.kind === "system");
  assert.equal(joinNotice.noticeType, "member-joined");
  assert.deepEqual(joinNotice.reactions, []);
  await assert.rejects(
    client.reactToItem(FM_ROOM_ID, String(joinNotice.id), "👏"),
    /only available on messages and match events/,
  );
  const demoDetails = await client.getRoomDetails(FM_ROOM_ID);
  assert.ok(demoDetails);
  assert.equal(demoDetails.influence.successfulJoins, 4);
  assert.equal(demoDetails.invite?.viewerSuccessfulJoins, 4);
  const prematchMessage = await client.sendMessage(FM_ROOM_ID, { text: "Checking in before kick-off." });
  assert.equal(Number(prematchMessage.createdAt) < FM_KICKOFF_MS + 60_000, true);
  for (const futureText of [
    "The room called the pressure",
    "Fair void",
    "Ice cold from the spot",
    "Check your report",
  ]) {
    assert.equal(
      state.items.some((item) => item.kind === "text" && item.text.includes(futureText)),
      false,
      `did not expect future social post containing “${futureText}” before kick-off`,
    );
  }

  client.jumpTo("call-open");
  const callsOpen = await client.getRoomState(FM_ROOM_ID);
  const threadedCall = callsOpen.items.find(
    (item) => item.kind === "call" && item.call.call.id === "call-score30",
  );
  assert.ok(threadedCall);
  assert.equal(threadedCall.replies.length, 2);
  assert.equal(callsOpen.typingUsers.length > 0, true);
  assert.equal(callsOpen.calls.find((call) => call.call.id === "call-score30")?.myAnswer, "yes");
  assert.equal(
    callsOpen.items.some((item) => item.kind === "text" && item.editedAt !== undefined),
    true,
  );

  client.jumpTo("goal");
  const goal = await client.getRoomState(FM_ROOM_ID);
  const threadedGoal = goal.items.find(
    (item) => item.kind === "event" && item.event.id === "ev-goal-23",
  );
  const goalChat = goal.items.find(
    (item) => item.kind === "text" && item.text.includes("still celebrating the pass"),
  );
  assert.ok(threadedGoal);
  assert.ok(goalChat);
  assert.equal(threadedGoal.replies.length, 3);
  assert.equal(threadedGoal.matchMinute, 23);
  assert.equal(goalChat.matchMinute, undefined);
  assert.ok(goalChat.feedTs);
  assert.equal(
    goal.items.every(
      (item) => item.feedTs === undefined
        || Number(item.feedTs) <= Number(goal.fixtureState.lastFeedTs),
    ),
    true,
  );
  assert.equal(goal.items.some((item) => item.kind === "receipt"), false);
  assert.equal(goal.receipts.length > 0, true);

  client.jumpTo("second-half");
  const secondHalf = await client.getRoomState(FM_ROOM_ID);
  assert.equal(secondHalf.items.filter((item) => item.kind === "image").length >= 2, true);

  client.jumpTo("goal-mar");
  const equaliser = await client.getRoomState(FM_ROOM_ID);
  assert.equal(
    equaliser.items.some(
      (item) => item.kind === "text" && item.text.includes("The room called the pressure"),
    ),
    true,
  );
  assert.equal(
    equaliser.items.some((item) => item.kind === "text" && item.text.includes("Ice cold from the spot")),
    false,
  );

  client.jumpTo("penalty");
  const penalty = await client.getRoomState(FM_ROOM_ID);
  assert.equal(
    penalty.items.some((item) => item.kind === "text" && item.text.includes("Fair void")),
    true,
  );
  assert.equal(
    penalty.items.some((item) => item.kind === "text" && item.text.includes("Ice cold from the spot")),
    true,
  );
  assert.equal(
    penalty.items.some((item) => item.kind === "text" && item.text.includes("Check your report")),
    false,
  );

  client.jumpTo("fulltime");
  const fulltime = await client.getRoomState(FM_ROOM_ID);
  assert.deepEqual(
    [...new Set(fulltime.items.map((item) => item.kind))].sort(),
    ["call", "event", "image", "odds", "poll", "system", "text"],
  );
  assert.equal(fulltime.receipts.length > 0, true);
  assert.equal(fulltime.polls.length >= 2, true);
  assert.equal(fulltime.fanIq.fanIq > 0, true);
  const report = await client.getReport(FM_ROOM_ID);
  assert.ok(report);
  assert.equal(report.calls.length, 4);
  assert.equal(report.calls.filter((call) => call.outcome === "correct").length, 2);
  assert.equal(report.calls.filter((call) => call.outcome === "incorrect").length, 1);
  assert.equal(report.calls.filter((call) => call.outcome === "void").length, 1);

  await client.enterDemoRoom();
  const replayed = await client.getRoomState(FM_ROOM_ID);
  assert.equal(replayed.fixtureState.minute, null);
  assert.equal(replayed.members.filter((member) => member.displayName === "Demo Fan").length, 1);
  assert.equal(
    replayed.items.some(
      (item) => item.kind === "text" && item.text === "Checking in before kick-off.",
    ),
    false,
  );

  await client.signOut();
  await client.signIn("Amina");
  await client.renameRoom(FM_ROOM_ID, "Changed demo name");
  await client.regenerateInvite(FM_ROOM_ID);
  await client.closeRoom(FM_ROOM_ID);

  const restored = await client.enterDemoRoom();
  const restoredDetails = await client.getRoomDetails(FM_ROOM_ID);
  assert.equal(restored.room.inviteCode, "AZZURRI");
  assert.equal(restored.room.room.name, "The Away End");
  assert.equal(restoredDetails?.isClosed, false);
  assert.equal(restoredDetails?.invite?.status, "active");
});

test("a newly created private room inherits its fixture's verified mixed feed", async () => {
  const client = new MockDataClient();
  client.jumpTo("fulltime");
  const created = await client.createRoom({
    fixtureId: "9001",
    roomName: "Private fixture feed",
    displayName: "Amina",
  });

  const state = await client.getRoomState(String(created.room.id));
  const kinds = new Set(state.items.map((item) => item.kind));
  for (const kind of ["call", "event", "odds", "system"] as const) {
    assert.equal(kinds.has(kind), true, `expected ${kind} in the created room feed`);
  }
  assert.equal(kinds.has("receipt"), false);
  assert.equal(state.items.every((item) => item.roomId === created.room.id), true);
  assert.equal(state.calls.every((view) => view.myAnswer === undefined), true);
  assert.equal(state.fanIq.fanIq, 0);
  assert.equal(state.fanIq.roomSize, 1);
  assert.equal(state.polls.length, 0);
  assert.equal(state.notes.length, 0);
  assert.equal(state.receipts.every((view) => view.receipt.subject.kind === "moment"), true);
});

test("prediction answers and Fan IQ stay scoped to one room member", async () => {
  const client = new MockDataClient();
  client.jumpTo("call-open");
  const created = await client.createRoom({
    fixtureId: "9001",
    roomName: "Scoped predictions",
    displayName: "Alice",
  });
  const roomId = String(created.room.id);
  const inviteCode = created.invite!.code;

  await client.submitAnswer(roomId, "call-score30", "yes");
  client.jumpTo("goal");
  const aliceState = await client.getRoomState(roomId);
  assert.equal(aliceState.calls.find((view) => view.call.id === "call-score30")?.myAnswer, "yes");
  assert.ok(aliceState.fanIq.fanIq > 0);

  await client.signOut();
  await client.signIn("Bob");
  await client.joinRoom(inviteCode, "u-alice");
  const bobState = await client.getRoomState(roomId);
  assert.equal(bobState.calls.every((view) => view.myAnswer === undefined), true);
  assert.equal(bobState.fanIq.fanIq, 0);
  await assert.rejects(client.submitAnswer(roomId, "call-score30", "yes"), /no longer open/);

  client.jumpTo("fulltime");
  const bobReport = await client.getReport(roomId);
  assert.ok(bobReport);
  assert.equal(bobReport.calls.length, 0);

  await client.signOut();
  await client.signIn("Alice");
  const aliceReport = await client.getReport(roomId);
  assert.ok(aliceReport);
  assert.deepEqual(aliceReport.calls.map((call) => call.callId), ["call-score30"]);
  const aliceRecord = await client.getRecord();
  assert.ok(aliceRecord);
  assert.equal(aliceRecord.entries.some((entry) => entry.callId === "call-score30"), true);

  const secondRoom = await client.createRoom({
    fixtureId: "9001",
    roomName: "Same match, different room",
    displayName: "Alice",
  });
  const secondState = await client.getRoomState(String(secondRoom.room.id));
  assert.equal(secondState.calls.find((view) => view.call.id === "call-score30")?.myAnswer, "yes");
  const dedupedRecord = await client.getRecord();
  assert.ok(dedupedRecord);
  assert.equal(dedupedRecord.entries.filter((entry) => entry.callId === "call-score30").length, 1);
});

test("invite previews expose fixture context but private room reads require membership", async () => {
  const client = new MockDataClient();
  const created = await client.createRoom({
    fixtureId: "9001",
    roomName: "Members only",
    displayName: "Alice",
  });
  const roomId = String(created.room.id);
  const inviteCode = created.invite!.code;

  await client.signOut();
  const preview = await client.getRoomByInvite(inviteCode);
  assert.ok(preview);
  assert.equal(preview.fixture.score != null, true);
  assert.equal(await client.getRoom(roomId), null);
  assert.equal(await client.getRoomDetails(roomId), null);
  await assert.rejects(client.getRoomState(roomId), /invite-only/);
  assert.throws(() => client.subscribeRoomState(roomId, () => undefined), /invite-only/);

  await client.signIn("Bob");
  await client.joinRoom(inviteCode, "u-alice");
  assert.ok(await client.getRoom(roomId));
  assert.ok(await client.getRoomState(roomId));
});

test("thread replies stay chronological and repeated reactions are deduplicated per account", async () => {
  const client = new MockDataClient();
  await client.signIn("Amina");
  const itemId = "item-message-welcome";

  await client.reactToItem(FM_ROOM_ID, itemId, "👀");
  await client.reactToItem(FM_ROOM_ID, itemId, "👀");
  await client.sendReply(FM_ROOM_ID, itemId, { text: "First reply" });
  await client.sendReply(FM_ROOM_ID, itemId, { text: "Second reply" });

  const state = await client.getRoomState(FM_ROOM_ID);
  const item = state.items.find((candidate) => candidate.id === itemId);
  assert.ok(item);
  assert.equal(item.reactions.find((reaction) => reaction.emoji === "👀")?.count, 4);
  assert.equal(item.reactions.find((reaction) => reaction.emoji === "👀")?.reactedByMe, true);
  assert.deepEqual(item.replies.slice(-2).map((reply) => reply.text), ["First reply", "Second reply"]);
  assert.deepEqual(item.replies, orderThreadReplies(item.replies));
});

test("only chat messages and match events accept reactions", async () => {
  const client = new MockDataClient();
  await client.signIn("Amina");
  client.jumpTo("fulltime");

  const state = await client.getRoomState(FM_ROOM_ID);
  for (const kind of ["system", "poll", "call", "odds"] as const) {
    const item = state.items.find((candidate) => candidate.kind === kind);
    assert.ok(item, `expected a ${kind} item`);
    await assert.rejects(
      client.reactToItem(FM_ROOM_ID, String(item.id), "👏"),
      /only available on messages and match events/,
    );
  }

  for (const kind of ["text", "image", "event"] as const) {
    const item = state.items.find((candidate) => candidate.kind === kind);
    assert.ok(item, `expected a ${kind} item`);
    await client.reactToItem(FM_ROOM_ID, String(item.id), "👏");
  }

  const reacted = await client.getRoomState(FM_ROOM_ID);
  for (const kind of ["text", "image", "event"] as const) {
    const item = reacted.items.find((candidate) => candidate.kind === kind);
    assert.equal(
      item?.reactions.some((reaction) => reaction.emoji === "👏" && reaction.reactedByMe),
      true,
    );
  }
});

test("poll reconciliation keeps one viewer vote and its selected option", async () => {
  const client = new MockDataClient();
  await client.signIn("Amina");
  await client.votePoll(FM_ROOM_ID, "poll-lineups", "france");
  const state = await client.getRoomState(FM_ROOM_ID);
  const item = state.items.find(
    (candidate): candidate is Extract<RoomFeedItem, { kind: "poll" }> =>
      candidate.kind === "poll" && candidate.poll.id === "poll-lineups",
  );
  assert.ok(item);
  assert.equal(item.myVote, "france");
  assert.equal(item.poll.options.find((option) => option.id === "france")?.votes, 6);
  assert.equal(item.poll.options.reduce((total, option) => total + option.votes, 0), 9);
});

test("unread cursors persist per room member and advance at the live edge", async () => {
  const client = new MockDataClient();
  await client.signIn("Amina");
  const initial = await client.getRoomState(FM_ROOM_ID);
  assert.equal(initial.unreadState.count, 3);
  const latest = initial.items.at(-1);
  assert.ok(latest);
  await client.markRoomRead(FM_ROOM_ID, String(latest.id));
  assert.equal((await client.getRoomState(FM_ROOM_ID)).unreadState.count, 0);

  await client.signOut();
  await client.signIn("Bob");
  await client.joinRoom("AZZURRI", "u-amina");
  const message = await client.sendMessage(FM_ROOM_ID, { text: "A new message for Amina" });

  await client.signOut();
  await client.signIn("Amina");
  const withUnread = await client.getRoomState(FM_ROOM_ID);
  assert.equal(withUnread.unreadState.count, 2);
  assert.notEqual(withUnread.unreadState.firstUnreadItemId, message.id);
  assert.equal(withUnread.items.at(-1)?.id, message.id);
  assert.equal(withUnread.unreadState.isAtLiveEdge, false);
});

test("MatchSync calibration is scoped per viewer inside one room", async () => {
  const client = new MockDataClient();
  await client.signIn("Amina");
  await client.setCalibration(FM_ROOM_ID, 8, "manual-minute");
  const aminaState = await client.getRoomState(FM_ROOM_ID);
  const aminaEvent = aminaState.items.find((item) => item.kind === "event");
  assert.ok(aminaEvent?.feedTs);
  assert.equal(Number(aminaEvent.releaseAt) - Number(aminaEvent.feedTs), 8_000);

  await client.signOut();
  await client.signIn("Bob");
  await client.joinRoom("AZZURRI", "u-amina");
  await client.setCalibration(FM_ROOM_ID, 42, "manual-minute");
  const bobState = await client.getRoomState(FM_ROOM_ID);
  const bobEvent = bobState.items.find((item) => item.kind === "event");
  assert.ok(bobEvent?.feedTs);
  assert.equal(Number(bobEvent.releaseAt) - Number(bobEvent.feedTs), 42_000);

  await client.signOut();
  await client.signIn("Amina");
  assert.equal((await client.getCalibration(FM_ROOM_ID))?.delaySeconds, 8);
});

test("MatchSync withholds the current beat until the viewer-safe release time", async () => {
  const client = new MockDataClient();
  await client.signIn("Amina");
  client.jumpTo("goal");
  await client.setCalibration(FM_ROOM_ID, 42, "manual-minute");

  const beforeRelease = await client.getRoomState(FM_ROOM_ID);
  assert.equal(beforeRelease.fixtureState.minute, 12);
  assert.equal(beforeRelease.items.some((item) => item.kind === "event" && item.event.kind === "goal"), false);

  client.advancePresentationBy(42_000);
  const afterRelease = await client.getRoomState(FM_ROOM_ID);
  assert.equal(afterRelease.fixtureState.minute, 23);
  assert.equal(afterRelease.items.some((item) => item.kind === "event" && item.event.kind === "goal"), true);
});

test("messages sent after full time stay at the chronological live edge", async () => {
  const client = new MockDataClient();
  await client.signIn("Amina");
  client.jumpTo("fulltime");
  const message = await client.sendMessage(FM_ROOM_ID, { text: "What a finish." });
  const state = await client.getRoomState(FM_ROOM_ID);
  assert.equal(state.items.at(-1)?.id, message.id);
  assert.ok(Number(message.createdAt) > Number(state.fixtureState.lastFeedTs));
});

test("Influence counts unique attributed joins and remains separate from Fan IQ", async () => {
  const client = new MockDataClient();
  const created = await client.createRoom({
    fixtureId: "9001",
    roomName: "Alice's room",
    displayName: "Alice",
  });
  const roomId = String(created.room.id);
  const invite = await client.createInvite(roomId);
  assert.match(invite.url, new RegExp(`/join/${invite.code}\\?ref=u-alice$`));

  await client.signOut();
  await client.signIn("Bob");
  await client.joinRoom(invite.code, "u-alice");
  await client.joinRoom(invite.code, "u-alice");

  await client.signOut();
  await client.signIn("Charlie");
  await client.joinRoom(invite.code, "u-alice");

  await client.signOut();
  await client.signIn("Bob");
  await client.leaveRoom(roomId);
  await client.joinRoom(invite.code, "u-charlie");

  await client.signOut();
  await client.signIn("Charlie");
  const charlieDetails = await client.getRoomDetails(roomId);
  assert.ok(charlieDetails);
  assert.equal(charlieDetails.influence.successfulJoins, 0);

  await client.signOut();
  await client.signIn("Dana");
  await client.joinRoom(invite.code); // A successful join, but not Alice-attributed.

  await client.signOut();
  await client.signIn("Alice");
  await client.createInvite(roomId); // Copy/share intent alone awards nothing.
  const details = await client.getRoomDetails(roomId);
  assert.ok(details);
  assert.equal(details.influence.successfulJoins, 2);
  assert.equal(details.influence.score, 200);
  assert.equal(details.fanIq.fanIq, 0);
  assert.equal(details.invite?.successfulJoins, 3);
  assert.equal(details.invite?.viewerSuccessfulJoins, 2);
});

test("revoked and expired invites cannot be previewed or joined", async () => {
  const client = new MockDataClient();
  await client.signIn("Bob");
  assert.equal(await client.getRoomByInvite("REVOKED"), null);
  assert.equal(await client.getRoomByInvite("EXPIRED"), null);
  await assert.rejects(client.joinRoom("REVOKED"), /revoked/);
  await assert.rejects(client.joinRoom("EXPIRED"), /expired/);

  const created = await client.createRoom({
    fixtureId: "9002",
    roomName: "Rotating code",
    displayName: "Creator",
  });
  const oldCode = created.invite!.code;
  const nextInvite = await client.regenerateInvite(String(created.room.id));
  assert.notEqual(nextInvite.code, oldCode);
  assert.equal(await client.getRoomByInvite(oldCode), null);
  await assert.rejects(client.joinRoom(oldCode), /revoked/);
});

test("creator-only moderation rejects members and applies creator changes", async () => {
  const client = new MockDataClient();
  const created = await client.createRoom({
    fixtureId: "9003",
    roomName: "Creator controls",
    displayName: "Alice",
  });
  const roomId = String(created.room.id);
  const code = created.invite!.code;

  await client.signOut();
  await client.signIn("Bob");
  await client.joinRoom(code, "u-alice");
  await assert.rejects(client.renameRoom(roomId, "Hijacked"), /Only the room creator/);
  await assert.rejects(client.setSlowMode(roomId, 10), /Only the room creator/);

  await client.signOut();
  await client.signIn("Alice");
  await client.renameRoom(roomId, "Renamed by creator");
  await client.setSlowMode(roomId, 12);
  await client.setMemberRole(roomId, "u-bob", "moderator");
  const details = await client.getRoomDetails(roomId);
  assert.ok(details);
  assert.equal(details.room.name, "Renamed by creator");
  assert.equal(details.slowModeSeconds, 12);
  assert.equal(details.members.find((member) => member.userId === "u-bob")?.role, "moderator");

  await client.sendMessage(roomId, { text: "First slow-mode message" });
  await assert.rejects(client.sendMessage(roomId, { text: "Too soon" }), /Slow mode/);

  await client.closeRoom(roomId);
  const closed = await client.getRoomDetails(roomId);
  assert.ok(closed);
  assert.equal(closed.isClosed, true);
  assert.equal(closed.invite, null);
  assert.equal(closed.room.inviteCode, undefined);
  assert.deepEqual(closed.permissions, {
    canInvite: false,
    canRename: false,
    canRegenerateInvite: false,
    canRevokeInvite: false,
    canModerateMembers: false,
    canSetSlowMode: false,
    canCloseRoom: false,
  });
  await client.leaveRoom(roomId);
  assert.equal(await client.getRoom(roomId), null);
  assert.equal(await client.getRoomDetails(roomId), null);
});
