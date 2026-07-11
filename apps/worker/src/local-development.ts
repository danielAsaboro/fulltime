/**
 * Operator-only local development authority.
 *
 * This opens the production signed fixture publisher and serves a signed
 * loopback manifest. It deliberately publishes no synthetic fixtures: attach
 * the normal TxLINE operator service to the same persistent publisher storage
 * when real feed data is available.
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLogger } from "./logger.js";
import {
  createSignedNetworkManifest,
  manifestVerificationPublicKey,
} from "./network-manifest.js";
import { FixturePlanePublisher } from "./publisher/fixture-publisher.js";

const HOST = "127.0.0.1";
const MANIFEST_PATH = "/v1/network.json";
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.join(packageRoot, ".local-development");
const publisherRoot = path.join(runtimeRoot, "fixture-publisher");
const signingKeyPath = path.join(runtimeRoot, "manifest-signing-key.pem");
const runtimePath = path.join(runtimeRoot, "runtime.json");

const log = createLogger("info");
const signingKey = await loadOrCreateSigningKey();
const publisher = new FixturePlanePublisher({
  storageDir: publisherRoot,
  log,
  networking: true,
});
const descriptor = await publisher.open();
const manifest = createSignedNetworkManifest({ fixtureFeedKey: descriptor.key }, signingKey);
const body = JSON.stringify(manifest);

const server = http.createServer((request, response) => {
  if (request.method !== "GET" || request.url !== MANIFEST_PATH) {
    response.writeHead(request.method === "GET" ? 404 : 405, {
      "cache-control": "no-store",
      "content-length": "0",
      "x-content-type-options": "nosniff",
    });
    response.end();
    return;
  }
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "x-content-type-options": "nosniff",
  });
  response.end(body);
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, HOST, resolve);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("Local manifest service did not bind a TCP address");
const endpoint = `http://${HOST}:${address.port}${MANIFEST_PATH}`;
const publicKey = manifestVerificationPublicKey(signingKey);

await writeRuntime({
  version: 1,
  pid: process.pid,
  endpoint,
  publicKey,
  fixtureFeedKey: descriptor.key,
  startedAt: Date.now(),
});

log.info("Local FullTime operator authority is ready", {
  endpoint,
  fixtureFeedKey: descriptor.key,
  runtimePath,
  fixtureCount: publisher.length,
});

let closing: Promise<void> | null = null;
const close = (): Promise<void> => {
  if (closing) return closing;
  closing = (async () => {
    await closeServer();
    await publisher.close();
    await fs.rm(runtimePath, { force: true });
  })();
  return closing;
};

process.once("SIGINT", () => void close().finally(() => process.exit(0)));
process.once("SIGTERM", () => void close().finally(() => process.exit(0)));

async function loadOrCreateSigningKey(): Promise<KeyObject> {
  await fs.mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  try {
    return createPrivateKey(await fs.readFile(signingKeyPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  await fs.writeFile(signingKeyPath, pem, { flag: "wx", mode: 0o600 });
  await fs.chmod(signingKeyPath, 0o600);
  const key = createPrivateKey(pem);
  if (createPublicKey(key).asymmetricKeyType !== "ed25519") {
    throw new Error("Local manifest key generation did not produce Ed25519");
  }
  return key;
}

async function writeRuntime(value: Record<string, unknown>): Promise<void> {
  const temporary = `${runtimePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, runtimePath);
    await fs.chmod(runtimePath, 0o600);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function closeServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
