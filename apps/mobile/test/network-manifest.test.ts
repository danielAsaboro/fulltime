import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { signNetworkManifest } from "../../desktop/lib/network-manifest.js";
import { resolveNetworkManifest, verifyNetworkManifest } from "../src/network-manifest";

function fixture() {
  const keys = crypto.generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const manifest = signNetworkManifest({ version: 1, issuedAt: 1_750_000_000_000, fixtureFeedKey: "ab".repeat(32) }, keys.privateKey, 1_750_000_000_000);
  return { keys, publicKey, manifest };
}

test("mobile verifies the operator canonical Ed25519 manifest", () => {
  const { publicKey, manifest } = fixture();
  assert.deepEqual(verifyNetworkManifest(manifest, publicKey, 1_750_000_000_000), manifest);
});

test("mobile rejects a changed authority pin", () => {
  const { publicKey, manifest } = fixture();
  assert.throws(() => verifyNetworkManifest({ ...manifest, fixtureFeedKey: "cd".repeat(32) }, publicKey, 1_750_000_000_000), /did not verify/);
});

test("mobile uses only a reverified cached or bundled manifest when refresh is unavailable", async () => {
  const { publicKey, manifest } = fixture();
  let cache: string | null = null;
  const storage = { read: async () => cache, write: async (value: string) => { cache = value; } };
  const first = await resolveNetworkManifest({ endpoint: null, publicKey, initialManifest: manifest }, storage);
  assert.equal(first.source, "bundled-cache");
  const second = await resolveNetworkManifest({ endpoint: null, publicKey, initialManifest: null }, storage);
  assert.equal(second.source, "cache");
  assert.equal(second.stale, true);
});

test("mobile fails precisely with no trust root or verified cache", async () => {
  await assert.rejects(resolveNetworkManifest({ endpoint: null, publicKey: null, initialManifest: null }, { read: async () => null, write: async () => undefined }), /no network trust root/);
});
