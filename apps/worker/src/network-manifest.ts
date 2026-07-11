/**
 * Operator-owned signed network manifest. Desktop releases contain only the
 * matching Ed25519 public key; the signing key remains in operator deployment
 * storage and is never part of the fixture feed or a consumer environment.
 */

import {
  createPrivateKey,
  createPublicKey,
  KeyObject,
  sign,
  verify,
} from "node:crypto";
import fs from "node:fs/promises";
import https from "node:https";

export const NETWORK_MANIFEST_VERSION = 1 as const;
const KEY_PATTERN = /^[a-f0-9]{64}$/;

export interface AnswerAttestorPins {
  servicePublicKey: string;
  receiptFeedKey: string;
}

export interface AnchorObserverPin {
  publicKey: string;
  endpoint: string;
}

export interface UnsignedNetworkManifest {
  version: typeof NETWORK_MANIFEST_VERSION;
  issuedAt: number;
  fixtureFeedKey: string;
  answerAttestor?: AnswerAttestorPins;
  anchorObserver?: AnchorObserverPin;
}

export interface SignedNetworkManifest extends UnsignedNetworkManifest {
  signature: string;
}

export interface NetworkManifestServiceOptions {
  manifest: SignedNetworkManifest;
  host: string;
  port: number;
  pathname: string;
  tlsCertificatePath: string;
  tlsPrivateKeyPath: string;
}

export interface NetworkManifestService {
  url: string;
  close(): Promise<void>;
}

export function canonicalNetworkManifest(manifest: UnsignedNetworkManifest): string {
  return canonicalize(normalizeUnsignedManifest(manifest));
}

export function createSignedNetworkManifest(
  manifest: Omit<UnsignedNetworkManifest, "version" | "issuedAt"> & Partial<Pick<UnsignedNetworkManifest, "issuedAt">>,
  privateKey: KeyObject | string | Buffer,
  now = Date.now(),
): SignedNetworkManifest {
  const unsigned = normalizeUnsignedManifest({
    ...manifest,
    version: NETWORK_MANIFEST_VERSION,
    issuedAt: manifest.issuedAt ?? now,
  });
  const signingKey = normalizeEd25519PrivateKey(privateKey);
  return {
    ...unsigned,
    signature: sign(null, Buffer.from(canonicalize(unsigned)), signingKey).toString("base64url"),
  };
}

export async function loadManifestSigningKey(filename: string): Promise<KeyObject> {
  if (typeof filename !== "string" || !filename) throw new Error("Manifest signing key path is required");
  const key = normalizeEd25519PrivateKey(await fs.readFile(filename));
  return key;
}

export function manifestVerificationPublicKey(privateKey: KeyObject | string | Buffer): string {
  const signingKey = normalizeEd25519PrivateKey(privateKey);
  return createPublicKey(signingKey).export({ type: "spki", format: "pem" }).toString();
}

export function verifySignedNetworkManifest(
  manifest: SignedNetworkManifest,
  publicKey: KeyObject | string | Buffer,
): SignedNetworkManifest {
  const normalized = normalizeSignedManifest(manifest);
  const signature = Buffer.from(normalized.signature, "base64url");
  const verificationKey = normalizeEd25519PublicKey(publicKey);
  if (signature.byteLength !== 64 || !verify(null, Buffer.from(canonicalize(stripSignature(normalized))), verificationKey, signature)) {
    throw new Error("Network manifest signature did not verify");
  }
  return normalized;
}

export async function startNetworkManifestService(options: NetworkManifestServiceOptions): Promise<NetworkManifestService> {
  const manifest = normalizeSignedManifest(options.manifest);
  const pathname = normalizeManifestPath(options.pathname);
  const host = normalizeHost(options.host);
  const port = normalizePort(options.port);
  const [cert, key] = await Promise.all([
    fs.readFile(options.tlsCertificatePath),
    fs.readFile(options.tlsPrivateKeyPath),
  ]);
  if (!cert.byteLength || !key.byteLength) throw new Error("Manifest TLS certificate and private key must not be empty");
  const body = JSON.stringify(manifest);
  const server = https.createServer({ cert, key }, (request, response) => {
    if (request.method !== "GET" || request.url !== pathname) {
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
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Manifest HTTPS service did not bind a TCP address");
  }
  return {
    url: `https://${formatUrlHost(host)}:${address.port}${pathname}`,
    close: () => closeServer(server),
  };
}

function normalizeUnsignedManifest(value: UnsignedNetworkManifest): UnsignedNetworkManifest {
  if (!value || typeof value !== "object" || value.version !== NETWORK_MANIFEST_VERSION ||
      !Number.isSafeInteger(value.issuedAt) || value.issuedAt < 0) {
    throw new Error("Network manifest has an invalid version or issue time");
  }
  const manifest: UnsignedNetworkManifest = {
    version: NETWORK_MANIFEST_VERSION,
    issuedAt: value.issuedAt,
    fixtureFeedKey: normalizeKey(value.fixtureFeedKey, "fixture feed"),
  };
  if (value.answerAttestor !== undefined) {
    manifest.answerAttestor = {
      servicePublicKey: normalizeKey(value.answerAttestor.servicePublicKey, "answer attestor"),
      receiptFeedKey: normalizeKey(value.answerAttestor.receiptFeedKey, "answer receipt feed"),
    };
  }
  if (value.anchorObserver !== undefined) {
    manifest.anchorObserver = {
      publicKey: normalizeKey(value.anchorObserver.publicKey, "anchor observer"),
      endpoint: normalizeHttpsEndpoint(value.anchorObserver.endpoint),
    };
  }
  return manifest;
}

function normalizeSignedManifest(value: SignedNetworkManifest): SignedNetworkManifest {
  const { signature, ...unsigned } = value;
  if (typeof signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(signature)) {
    throw new Error("Network manifest signature is invalid");
  }
  return { ...normalizeUnsignedManifest(unsigned), signature };
}

function normalizeEd25519PrivateKey(value: KeyObject | string | Buffer): KeyObject {
  const key = value instanceof KeyObject ? value : createPrivateKey(value);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Network manifest signing key must be Ed25519");
  return key;
}

function normalizeEd25519PublicKey(value: KeyObject | string | Buffer): KeyObject {
  const key = value instanceof KeyObject ? value : createPublicKey(value);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Network manifest verification key must be Ed25519");
  return key;
}

function stripSignature(manifest: SignedNetworkManifest): UnsignedNetworkManifest {
  const { signature: _signature, ...unsigned } = manifest;
  return unsigned;
}

function normalizeKey(value: string, label: string): string {
  if (typeof value !== "string" || !KEY_PATTERN.test(value)) {
    throw new Error(`Network manifest ${label} key must be 32-byte lowercase hex`);
  }
  return value;
}

function normalizeHttpsEndpoint(value: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("Network manifest anchor observer endpoint is invalid");
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error("Network manifest anchor observer endpoint must be credential-free HTTPS");
  }
  return endpoint.toString();
}

function normalizeManifestPath(value: string): string {
  if (typeof value !== "string" || !/^\/[A-Za-z0-9._~/-]{1,240}$/.test(value) || value.includes("//")) {
    throw new Error("Manifest HTTPS pathname is invalid");
  }
  return value;
}

function normalizeHost(value: string): string {
  if (typeof value !== "string" || !value || value.length > 253 || /[\u0000-\u0020]/.test(value)) {
    throw new Error("Manifest HTTPS host is invalid");
  }
  return value;
}

function normalizePort(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) throw new Error("Manifest HTTPS port must be 1-65535");
  return value;
}

function formatUrlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical manifest cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("Canonical manifest contains an unsupported value");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}

function closeServer(server: https.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
