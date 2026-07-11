/**
 * Subscription activation — the off-chain half of the auth chain.
 *
 * The on-chain `subscribe(serviceLevel, weeks)` transaction is produced with a
 * funded wallet outside this worker (TxODDS' tx-on-chain tooling); its confirmed
 * `txSig` is supplied via env. Given that, this module does the parts the worker
 * owns: build the strict binding message `${txSig}:${leagues}:${jwt}`, sign it with
 * the wallet's ed25519 key (Node-native — matches Solana's detached signature),
 * and hand the base64 signature to `/api/token/activate`.
 *
 * For direct streaming, prefer the token fast-path (seed TXLINE_JWT + TXLINE_API_TOKEN) and
 * skip this entirely.
 */

import crypto from "node:crypto";
import fs from "node:fs";

import type { Logger } from "../logger.js";
import type { TxlineAuth } from "./auth.js";

export interface ActivationInputs {
  keypairPath: string;
  txSig: string;
  leagues: number[];
}

/** The exact binding TxLINE expects, signed by the wallet. */
export function buildActivationMessage(txSig: string, leagues: number[], jwt: string): string {
  return `${txSig}:${leagues.join(",")}:${jwt}`;
}

/** Load a Solana secret key: solana-keygen JSON byte array, or a base58 secret. */
export function loadSecretKey(keypairPath: string): Uint8Array {
  const raw = fs.readFileSync(keypairPath, "utf8").trim();
  if (raw.startsWith("[")) {
    const bytes = JSON.parse(raw) as number[];
    return Uint8Array.from(bytes);
  }
  return base58Decode(raw);
}

/** Detached ed25519 signature over `message`, base64-encoded (Solana-compatible). */
export function signActivationMessage(secretKey: Uint8Array, message: string): string {
  if (secretKey.length !== 64) {
    throw new Error(`Expected a 64-byte Solana secret key, got ${secretKey.length} bytes`);
  }
  const seed = secretKey.subarray(0, 32);
  const publicKey = secretKey.subarray(32, 64);
  const privateKey = crypto.createPrivateKey({
    format: "jwk",
    key: {
      kty: "OKP",
      crv: "Ed25519",
      d: base64url(seed),
      x: base64url(publicKey),
    },
  });
  const signature = crypto.sign(null, Buffer.from(message, "utf8"), privateKey);
  return signature.toString("base64");
}

/**
 * Complete activation given a confirmed on-chain `txSig`: acquire a guest JWT if
 * needed, sign the binding, and exchange it for the API token.
 */
export async function activateWithKeypair(
  auth: TxlineAuth,
  inputs: ActivationInputs,
  log: Logger,
): Promise<string> {
  const jwt = auth.accessJwt ?? (await auth.startGuest());
  const secretKey = loadSecretKey(inputs.keypairPath);
  const message = buildActivationMessage(inputs.txSig, inputs.leagues, jwt);
  const walletSignature = signActivationMessage(secretKey, message);
  log.info("Signed activation binding; exchanging for API token", {
    leagues: inputs.leagues,
    txSig: `${inputs.txSig.slice(0, 8)}…`,
  });
  return auth.activate({ txSig: inputs.txSig, walletSignature, leagues: inputs.leagues });
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(input: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of input) {
    let carry = BASE58_ALPHABET.indexOf(char);
    if (carry < 0) throw new Error(`Invalid base58 character: ${char}`);
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of input) {
    if (char !== "1") break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}
