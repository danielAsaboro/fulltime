import assert from "node:assert/strict";
import test from "node:test";

import { roomReceiptHref } from "../lib/receipt-link";

test("receipt proof navigation always retains its private room context", () => {
  assert.equal(
    roomReceiptHref("room_alpha", "aat:abcdef:7"),
    "/room/room_alpha/receipt/aat%3Aabcdef%3A7",
  );
  assert.match(roomReceiptHref("room with space", "receipt/1"), /^\/room\/room%20with%20space\/receipt\//);
});
