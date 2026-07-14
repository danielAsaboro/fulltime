import assert from "node:assert/strict";
import test from "node:test";

import { inviteCodeFromInput } from "../src/invite-code";

const code = `ft2.${"a".repeat(8)}.${"b".repeat(8)}.${"c".repeat(8)}`;

test("mobile pasted joins normalize the same room links as QR joins", () => {
  assert.equal(inviteCodeFromInput(code), code);
  assert.equal(inviteCodeFromInput(`http://127.0.0.1:47831/join/${code}`), code);
  assert.equal(inviteCodeFromInput(`https://fulltime.example/join?invite=${encodeURIComponent(code)}`), code);
});

test("mobile pasted joins reject unrelated and partial values", () => {
  assert.throws(() => inviteCodeFromInput("https://example.com/not-a-room"), /FullTime room invite/);
  assert.throws(() => inviteCodeFromInput("ft2.only.partial"), /partially read/);
});
