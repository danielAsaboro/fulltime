import { test } from "node:test";
import assert from "node:assert/strict";

import { compareFeedOrder, dedupeByMessageId, orderFeed } from "../src/feed.js";
import { asFeedMessageId } from "../src/ids.js";
import { asFeedTimestamp } from "../src/time.js";

const msg = (ts: number | null, id: string | null) => ({
  feedTs: ts === null ? null : asFeedTimestamp(ts),
  messageId: id === null ? null : asFeedMessageId(id),
});

test("dedupeByMessageId keeps the first occurrence", () => {
  const out = dedupeByMessageId([msg(1, "a"), msg(2, "a"), msg(3, "b")]);
  assert.deepEqual(out.map((m) => m.feedTs), [1, 3]);
});

test("dedupeByMessageId keeps every id-less message", () => {
  const out = dedupeByMessageId([msg(1, null), msg(1, null)]);
  assert.equal(out.length, 2);
});

test("compareFeedOrder sorts by feed time, then message id", () => {
  assert.ok(compareFeedOrder(msg(1, "b"), msg(2, "a")) < 0);
  assert.ok(compareFeedOrder(msg(2, "a"), msg(2, "b")) < 0);
});

test("compareFeedOrder sends missing feed time to the end", () => {
  assert.ok(compareFeedOrder(msg(null, "a"), msg(5, "z")) > 0);
});

test("orderFeed dedupes then orders", () => {
  const out = orderFeed([msg(3, "c"), msg(1, "a"), msg(1, "a"), msg(2, "b")]);
  assert.deepEqual(out.map((m) => m.messageId), ["a", "b", "c"]);
});
