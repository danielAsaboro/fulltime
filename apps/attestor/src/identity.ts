import {
  answerAcceptanceSigningBytes,
  answerSubmissionSigningBytes,
  parseAnswerAcceptanceToken,
  parseSignedAnswerSubmission,
  type AnswerAcceptanceToken,
  type SignedAnswerSubmission,
} from "../../../packages/shared/src/answer-attestation.js";

import { AttestorError } from "./errors.js";
import { b4a, hypercoreCrypto, z32, type KeyPair } from "./holepunch.js";

export function userIdFromIdentityPublicKey(publicKey: Uint8Array): string {
  if (publicKey.byteLength !== 32) throw new TypeError("Identity public key must be 32 bytes");
  return `peer_${z32.encode(publicKey)}`;
}

export function signAnswerSubmission(
  keyPair: KeyPair,
  value: Omit<SignedAnswerSubmission, "identityPublicKey" | "signature">,
): SignedAnswerSubmission {
  if (keyPair.publicKey.byteLength !== 32 || keyPair.secretKey.byteLength !== 64) {
    throw new TypeError("Identity key pair is invalid");
  }
  const unsigned = {
    ...value,
    identityPublicKey: b4a.toString(keyPair.publicKey, "hex"),
  };
  const signature = hypercoreCrypto.sign(answerSubmissionSigningBytes(unsigned), keyPair.secretKey);
  return parseSignedAnswerSubmission({ ...unsigned, signature: b4a.toString(signature, "hex") });
}

export function verifyMemberSubmission(value: unknown): SignedAnswerSubmission {
  const submission = parseSignedAnswerSubmission(value);
  const publicKey = b4a.from(submission.identityPublicKey, "hex");
  if (submission.userId !== userIdFromIdentityPublicKey(publicKey)) {
    throw new AttestorError("IDENTITY_MISMATCH", "Answer user ID does not match its identity public key");
  }
  const signature = b4a.from(submission.signature, "hex");
  if (!hypercoreCrypto.verify(answerSubmissionSigningBytes(submission), signature, publicKey)) {
    throw new AttestorError("INVALID_SIGNATURE", "Answer identity signature is invalid");
  }
  return submission;
}

export function verifyAcceptanceToken(
  value: unknown,
  expectedServicePublicKey: string,
  expectedReceiptFeedKey?: string,
): AnswerAcceptanceToken {
  const token = parseAnswerAcceptanceToken(value);
  if (token.claims.servicePublicKey !== expectedServicePublicKey) {
    throw new AttestorError("SERVICE_IDENTITY_MISMATCH", "Acceptance token was signed by an unexpected service");
  }
  if (expectedReceiptFeedKey && token.claims.receiptFeedKey !== expectedReceiptFeedKey) {
    throw new AttestorError("RECEIPT_FEED_MISMATCH", "Acceptance token references an unexpected receipt feed");
  }
  const valid = hypercoreCrypto.verify(
    answerAcceptanceSigningBytes(token.claims),
    b4a.from(token.signature, "hex"),
    b4a.from(expectedServicePublicKey, "hex"),
  );
  if (!valid) throw new AttestorError("INVALID_SERVICE_SIGNATURE", "Acceptance token signature is invalid");
  return token;
}
