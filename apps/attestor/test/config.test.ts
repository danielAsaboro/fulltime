import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { loadAttestorConfig } from "../src/config.js";

test("attestor config accepts only operator CLI/environment trust roots", () => {
  const fixtureFeedKey = "11".repeat(32);
  const servicePublicKey = "22".repeat(32);
  const receiptFeedKey = "33".repeat(32);
  const config = loadAttestorConfig([
    "--storage", "./operator-state",
    "--fixture-feed-key", fixtureFeedKey,
    "--service-public-key", servicePublicKey,
    "--receipt-feed-key", receiptFeedKey,
    "--bootstrap", '[{"host":"127.0.0.1","port":49737}]',
  ], {});

  assert.equal(config.storageDir, path.resolve("./operator-state"));
  assert.equal(config.fixtureFeedKey, fixtureFeedKey);
  assert.equal(config.expectedServicePublicKey, servicePublicKey);
  assert.equal(config.expectedReceiptFeedKey, receiptFeedKey);
  assert.deepEqual(config.bootstrap, [{ host: "127.0.0.1", port: 49_737 }]);
  assert.throws(() => loadAttestorConfig(["--room-feed-key", fixtureFeedKey], {}), /Unsupported/);
});

test("attestor config fails closed when pinned keys are absent or malformed", () => {
  assert.throws(() => loadAttestorConfig([], {}), /storage is required/);
  assert.throws(
    () => loadAttestorConfig([], { FULLTIME_ATTESTOR_STORAGE: "/tmp/attestor" }),
    /Pinned fixture feed key is required/,
  );
  assert.throws(
    () => loadAttestorConfig([], {
      FULLTIME_ATTESTOR_STORAGE: "/tmp/attestor",
      FULLTIME_FIXTURE_FEED_KEY: "not-a-key",
    }),
    /Pinned fixture feed key is required/,
  );
});
