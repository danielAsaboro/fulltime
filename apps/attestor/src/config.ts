import path from "node:path";

import type { AnswerAttestorOptions } from "./service.js";
import type { BootstrapNode } from "./holepunch.js";

const HEX_KEY = /^[a-f0-9]{64}$/;

export function loadAttestorConfig(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): AnswerAttestorOptions {
  const args = parseArgs(argv);
  const storageDir = args.storage ?? env.FULLTIME_ATTESTOR_STORAGE;
  const fixtureFeedKey = args.fixtureFeedKey ?? env.FULLTIME_FIXTURE_FEED_KEY;
  const expectedServicePublicKey = args.servicePublicKey ?? env.FULLTIME_ATTESTOR_PUBLIC_KEY;
  const expectedReceiptFeedKey = args.receiptFeedKey ?? env.FULLTIME_ATTESTOR_RECEIPT_FEED_KEY;
  const bootstrapRaw = args.bootstrap ?? env.FULLTIME_ATTESTOR_BOOTSTRAP;

  if (!storageDir) {
    throw new Error("Answer attestor storage is required via --storage or FULLTIME_ATTESTOR_STORAGE");
  }
  if (!fixtureFeedKey || !HEX_KEY.test(fixtureFeedKey)) {
    throw new Error("Pinned fixture feed key is required as 32-byte lowercase hex via --fixture-feed-key or FULLTIME_FIXTURE_FEED_KEY");
  }
  if (expectedServicePublicKey && !HEX_KEY.test(expectedServicePublicKey)) {
    throw new Error("Expected attestor public key must be 32-byte lowercase hex");
  }
  if (expectedReceiptFeedKey && !HEX_KEY.test(expectedReceiptFeedKey)) {
    throw new Error("Expected receipt feed key must be 32-byte lowercase hex");
  }
  return {
    storageDir: path.resolve(storageDir),
    fixtureFeedKey,
    ...(expectedServicePublicKey ? { expectedServicePublicKey } : {}),
    ...(expectedReceiptFeedKey ? { expectedReceiptFeedKey } : {}),
    ...(bootstrapRaw ? { bootstrap: parseBootstrap(bootstrapRaw) } : {}),
  };
}

interface ParsedArgs {
  storage?: string;
  fixtureFeedKey?: string;
  servicePublicKey?: string;
  receiptFeedKey?: string;
  bootstrap?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const result: ParsedArgs = {};
  const mapping = new Map<string, keyof ParsedArgs>([
    ["--storage", "storage"],
    ["--fixture-feed-key", "fixtureFeedKey"],
    ["--service-public-key", "servicePublicKey"],
    ["--receipt-feed-key", "receiptFeedKey"],
    ["--bootstrap", "bootstrap"],
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    const key = flag ? mapping.get(flag) : undefined;
    if (!key) throw new Error(`Unsupported answer-attestor argument: ${flag ?? ""}`);
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (result[key] !== undefined) throw new Error(`Duplicate answer-attestor argument: ${flag}`);
    result[key] = value;
  }
  return result;
}

function parseBootstrap(raw: string): BootstrapNode[] {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Answer-attestor bootstrap must be a JSON array");
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw new Error("Answer-attestor bootstrap must contain 1-32 nodes");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Answer-attestor bootstrap node ${index} must be an object`);
    }
    const object = entry as Record<string, unknown>;
    if (Object.keys(object).length !== 2 || typeof object.host !== "string" || !object.host
      || object.host.length > 255 || !Number.isSafeInteger(object.port)
      || Number(object.port) < 1 || Number(object.port) > 65_535) {
      throw new Error(`Answer-attestor bootstrap node ${index} is invalid`);
    }
    return { host: object.host, port: Number(object.port) };
  });
}
