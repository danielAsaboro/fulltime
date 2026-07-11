/** Operator deploy check: fetch the public HTTPS manifest and verify its Ed25519 signature. */

import fs from "node:fs";

import { verifySignedNetworkManifest, type SignedNetworkManifest } from "./network-manifest.js";

const MAX_MANIFEST_BYTES = 16 * 1024;

async function main(): Promise<void> {
  const endpoint = process.env.FULLTIME_MANIFEST_PUBLIC_URL;
  const publicKey = readPublicKey();
  if (!endpoint || !publicKey) {
    throw new Error("FULLTIME_MANIFEST_PUBLIC_URL and a manifest public key value/path are required to verify deployment");
  }
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("FULLTIME_MANIFEST_PUBLIC_URL must be credential-free HTTPS");
  }
  const response = await fetch(url, { headers: { accept: "application/json" }, redirect: "error" });
  if (!response.ok) throw new Error(`Manifest deployment returned HTTP ${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text) < 2 || Buffer.byteLength(text) > MAX_MANIFEST_BYTES) {
    throw new Error("Manifest deployment response has an invalid size");
  }
  let value: SignedNetworkManifest;
  try {
    value = JSON.parse(text) as SignedNetworkManifest;
  } catch (error) {
    throw new Error("Manifest deployment response is not valid JSON", { cause: error });
  }
  const manifest = verifySignedNetworkManifest(value, publicKey);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    version: manifest.version,
    issuedAt: manifest.issuedAt,
    fixtureFeedKey: manifest.fixtureFeedKey,
    answerAttestorPinned: Boolean(manifest.answerAttestor),
    anchorObserverPinned: Boolean(manifest.anchorObserver),
  })}\n`);
}

function readPublicKey(): string {
  const inline = process.env.FULLTIME_MANIFEST_PUBLIC_KEY;
  const filename = process.env.FULLTIME_MANIFEST_PUBLIC_KEY_PATH;
  if (inline && filename) throw new Error("Set only one of FULLTIME_MANIFEST_PUBLIC_KEY or FULLTIME_MANIFEST_PUBLIC_KEY_PATH");
  if (inline) return inline;
  if (!filename) return "";
  return fs.readFileSync(filename, "utf8");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
