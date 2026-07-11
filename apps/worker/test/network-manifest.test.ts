import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";

import { canonicalNetworkManifest, createSignedNetworkManifest, verifySignedNetworkManifest } from "../src/network-manifest.js";

const require = createRequire(import.meta.url);
const desktopManifest = require("../../desktop/lib/network-manifest.js") as {
  canonicalNetworkManifest(value: unknown, now: number): string;
  verifyNetworkManifest(value: unknown, publicKey: unknown, now: number): { fixtureFeedKey: string };
};

test("operator manifest signing is canonical and verifies in the desktop trust boundary", () => {
  const now = 1_800_000_000_000;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signed = createSignedNetworkManifest({
    fixtureFeedKey: "ab".repeat(32),
    answerAttestor: {
      servicePublicKey: "cd".repeat(32),
      receiptFeedKey: "ef".repeat(32),
    },
  }, privateKey, now);

  assert.equal(canonicalNetworkManifest({
    version: 1,
    issuedAt: now,
    fixtureFeedKey: "ab".repeat(32),
    answerAttestor: {
      servicePublicKey: "cd".repeat(32),
      receiptFeedKey: "ef".repeat(32),
    },
  }), desktopManifest.canonicalNetworkManifest({
    version: 1,
    issuedAt: now,
    fixtureFeedKey: "ab".repeat(32),
    answerAttestor: {
      receiptFeedKey: "ef".repeat(32),
      servicePublicKey: "cd".repeat(32),
    },
  }, now));
  assert.equal(desktopManifest.verifyNetworkManifest(signed, publicKey, now).fixtureFeedKey, "ab".repeat(32));
  assert.equal(verifySignedNetworkManifest(signed, publicKey).fixtureFeedKey, "ab".repeat(32));
  assert.throws(() => desktopManifest.verifyNetworkManifest({ ...signed, fixtureFeedKey: "12".repeat(32) }, publicKey, now));
});
