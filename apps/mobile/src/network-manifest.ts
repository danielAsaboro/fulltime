import b4a from "b4a";
import nacl from "tweetnacl";

export const NETWORK_MANIFEST_VERSION = 1 as const;
export const MAX_MANIFEST_BYTES = 16 * 1024;
const MAX_FUTURE_ISSUED_AT_MS = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^[a-f0-9]{64}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const ED25519_SPKI_PREFIX = "302a300506032b6570032100";

export interface SignedNetworkManifest {
  version: typeof NETWORK_MANIFEST_VERSION;
  issuedAt: number;
  fixtureFeedKey: string;
  answerAttestor?: { servicePublicKey: string; receiptFeedKey: string };
  anchorObserver?: { publicKey: string; endpoint: string };
  signature: string;
}

export interface MobileNetworkConfig {
  endpoint: string | null;
  publicKey: string | null;
  initialManifest: unknown | null;
  fixtureRelay?: { host: string; port: number };
}

export interface NetworkResolution {
  manifest: SignedNetworkManifest;
  source: "network" | "cache" | "bundled-cache";
  stale: boolean;
  refreshError?: string;
}

export class MobileNetworkManifestError extends Error {
  code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MobileNetworkManifestError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new MobileNetworkManifestError(code, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function key(value: unknown, label: string): string {
  if (typeof value !== "string" || !KEY_PATTERN.test(value)) {
    fail("INVALID_SCHEMA", `${label} must be a 32-byte lowercase hex key`);
  }
  return value;
}

function parseUnsigned(value: unknown, now: number): Omit<SignedNetworkManifest, "signature"> {
  if (!isPlainObject(value) || !onlyKeys(value, ["version", "issuedAt", "fixtureFeedKey", "answerAttestor", "anchorObserver"])) {
    fail("INVALID_SCHEMA", "Network manifest has an invalid schema");
  }
  if (value.version !== NETWORK_MANIFEST_VERSION) fail("UNSUPPORTED_VERSION", "Network manifest version is unsupported");
  if (!Number.isSafeInteger(value.issuedAt) || Number(value.issuedAt) < 0 || Number(value.issuedAt) > now + MAX_FUTURE_ISSUED_AT_MS) {
    fail("INVALID_SCHEMA", "Network manifest issuedAt is invalid");
  }

  const manifest: Omit<SignedNetworkManifest, "signature"> = {
    version: NETWORK_MANIFEST_VERSION,
    issuedAt: Number(value.issuedAt),
    fixtureFeedKey: key(value.fixtureFeedKey, "fixtureFeedKey"),
  };

  if (Object.hasOwn(value, "answerAttestor")) {
    const pins = value.answerAttestor;
    if (!isPlainObject(pins) || !onlyKeys(pins, ["servicePublicKey", "receiptFeedKey"])) {
      fail("INVALID_SCHEMA", "Network manifest answer-attestor pins are invalid");
    }
    manifest.answerAttestor = {
      servicePublicKey: key(pins.servicePublicKey, "answerAttestor.servicePublicKey"),
      receiptFeedKey: key(pins.receiptFeedKey, "answerAttestor.receiptFeedKey"),
    };
  }

  if (Object.hasOwn(value, "anchorObserver")) {
    const pin = value.anchorObserver;
    if (!isPlainObject(pin) || !onlyKeys(pin, ["publicKey", "endpoint"]) || typeof pin.endpoint !== "string") {
      fail("INVALID_SCHEMA", "Network manifest anchor-observer pin is invalid");
    }
    let endpoint: URL;
    try {
      endpoint = new URL(pin.endpoint);
    } catch {
      fail("INVALID_SCHEMA", "Network manifest anchor-observer endpoint is invalid");
    }
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) {
      fail("INVALID_SCHEMA", "Network manifest anchor-observer endpoint must be credential-free HTTPS");
    }
    manifest.anchorObserver = { publicKey: key(pin.publicKey, "anchorObserver.publicKey"), endpoint: endpoint.toString() };
  }

  return manifest;
}

export function parseNetworkManifest(value: unknown, now = Date.now()): SignedNetworkManifest {
  if (!isPlainObject(value) || !onlyKeys(value, ["version", "issuedAt", "fixtureFeedKey", "answerAttestor", "anchorObserver", "signature"])) {
    fail("INVALID_SCHEMA", "Network manifest has an invalid schema");
  }
  if (typeof value.signature !== "string" || !SIGNATURE_PATTERN.test(value.signature)) {
    fail("INVALID_SCHEMA", "Network manifest signature is invalid");
  }
  const { signature, ...payload } = value;
  return { ...parseUnsigned(payload, now), signature };
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON does not allow non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (!isPlainObject(value)) throw new TypeError("Canonical JSON accepts only plain objects and arrays");
  return `{${Object.keys(value).sort().map((entry) => `${JSON.stringify(entry)}:${canonicalize(value[entry])}`).join(",")}}`;
}

function rawPublicKey(publicKeyPem: string): Uint8Array {
  const body = publicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "");
  let der: Uint8Array;
  try {
    der = b4a.from(body, "base64");
  } catch {
    return fail("INVALID_TRUST_ROOT", "Manifest verification key is not valid PEM");
  }
  if (der.byteLength !== 44 || b4a.toString(der.subarray(0, 12), "hex") !== ED25519_SPKI_PREFIX) {
    fail("INVALID_TRUST_ROOT", "Manifest verification key is not Ed25519 SPKI");
  }
  return der.subarray(12);
}

function base64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "==";
  return b4a.from(base64, "base64");
}

export function verifyNetworkManifest(value: unknown, publicKeyPem: string, now = Date.now()): SignedNetworkManifest {
  const manifest = parseNetworkManifest(value, now);
  const { signature, ...payload } = manifest;
  const signatureBytes = base64Url(signature);
  if (signatureBytes.byteLength !== nacl.sign.signatureLength || !nacl.sign.detached.verify(
    b4a.from(canonicalize(payload), "utf8"),
    signatureBytes,
    rawPublicKey(publicKeyPem),
  )) {
    fail("INVALID_SIGNATURE", "Network manifest signature did not verify");
  }
  return manifest;
}

function parseManifestText(text: string, publicKey: string): SignedNetworkManifest {
  if (b4a.byteLength(text) < 2 || b4a.byteLength(text) > MAX_MANIFEST_BYTES) {
    fail("INVALID_RESPONSE", "Network manifest response has an invalid size");
  }
  try {
    return verifyNetworkManifest(JSON.parse(text), publicKey);
  } catch (error) {
    if (error instanceof MobileNetworkManifestError) throw error;
    throw new MobileNetworkManifestError("INVALID_RESPONSE", "Network manifest response is not valid JSON", { cause: error });
  }
}

export async function resolveNetworkManifest(
  config: MobileNetworkConfig,
  storage: { read(): Promise<string | null>; write(value: string): Promise<void> },
  fetchImpl: typeof fetch = fetch,
): Promise<NetworkResolution> {
  if (!config.publicKey) fail("CONFIGURATION_UNAVAILABLE", "This FullTime build has no network trust root");
  let refreshError = "ENDPOINT_UNCONFIGURED";

  if (config.endpoint) {
    try {
      const endpoint = new URL(config.endpoint);
      if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) {
        fail("ENDPOINT_INVALID", "Network manifest endpoint must be credential-free HTTPS");
      }
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 8_000);
      try {
        const response = await fetchImpl(endpoint.toString(), {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
          redirect: "error",
          signal: abort.signal,
        });
        if (!response.ok) fail("FETCH_FAILED", `Network manifest request failed (${response.status})`);
        const manifest = parseManifestText(await response.text(), config.publicKey);
        await storage.write(JSON.stringify(manifest));
        return { manifest, source: "network", stale: false };
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      refreshError = error instanceof MobileNetworkManifestError ? error.code : "FETCH_FAILED";
    }
  }

  let cachedManifest: SignedNetworkManifest | null = null;
  const cached = await storage.read().catch(() => null);
  if (cached) {
    try {
      cachedManifest = parseManifestText(cached, config.publicKey);
    } catch {
      // A cache is never trusted merely because it was stored previously.
    }
  }

  let bundledManifest: SignedNetworkManifest | null = null;
  if (config.initialManifest) bundledManifest = verifyNetworkManifest(config.initialManifest, config.publicKey);

  // Local signed manifests can rotate the fixture feed between app builds.
  // Never let a valid but older device cache override a newer signed manifest
  // embedded in the installed build.
  if (bundledManifest && (!cachedManifest || bundledManifest.issuedAt > cachedManifest.issuedAt)) {
    await storage.write(JSON.stringify(bundledManifest)).catch(() => undefined);
    return { manifest: bundledManifest, source: "bundled-cache", stale: true, refreshError };
  }
  if (cachedManifest) return { manifest: cachedManifest, source: "cache", stale: true, refreshError };
  if (bundledManifest) {
    await storage.write(JSON.stringify(bundledManifest)).catch(() => undefined);
    return { manifest: bundledManifest, source: "bundled-cache", stale: true, refreshError };
  }

  fail("CONFIGURATION_UNAVAILABLE", "FullTime network configuration is unavailable. Connect and try again.");
}
