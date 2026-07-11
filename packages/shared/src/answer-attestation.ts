/**
 * Strict wire and receipt contracts for the answer-attestation service.
 *
 * A room member signs `answerSubmissionSigningBytes(request)`. The attestor then
 * verifies that signature and the publisher-signed call before signing an
 * `AnswerAcceptanceToken`. Both signatures cover canonical arrays rather than
 * object serialization order.
 */

export const ANSWER_ATTESTATION_VERSION = 2 as const;
export const ANSWER_ATTESTATION_PROTOCOL = "fulltime/answer-attestation/2" as const;
export const ANSWER_SUBMISSION_SIGNATURE_CONTEXT = "fulltime/answer-submission/v2" as const;
export const ANSWER_ACCEPTANCE_SIGNATURE_CONTEXT = "fulltime/answer-acceptance/v2" as const;
export const MAX_ANSWER_ATTESTATION_FRAME_BYTES = 32 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const HEX_32 = /^[a-f0-9]{64}$/;
const HEX_64 = /^[a-f0-9]{128}$/;
const IDENTIFIER = /^[\p{L}\p{N}][\p{L}\p{N}._:/-]*$/u;

export interface SignedAnswerSubmission {
  version: typeof ANSWER_ATTESTATION_VERSION;
  requestId: string;
  answerId: string;
  callId: string;
  userId: string;
  optionId: string;
  /** Member wall clock at the tap. Server receive time remains authoritative. */
  submittedAt: number;
  /** Lowercase hex Ed25519 public key from which `userId` is derived. */
  identityPublicKey: string;
  /** Detached Ed25519 signature over `answerSubmissionSigningBytes`. */
  signature: string;
}

export interface AnswerAcceptanceClaims {
  version: typeof ANSWER_ATTESTATION_VERSION;
  tokenId: string;
  receiptIndex: number;
  servicePublicKey: string;
  receiptFeedKey: string;
  serviceReceivedAt: number;
  deadlineAt: number;
  fixtureFeedKey: string;
  fixtureFeedFork: number;
  fixtureFeedLength: number;
  fixtureFeedTreeHash: string;
  callFeedIndex: number;
  fixtureId: string;
  locksAt: number;
  submission: SignedAnswerSubmission;
}

export interface AnswerAcceptanceToken {
  claims: AnswerAcceptanceClaims;
  /** Detached Ed25519 application signature made by `servicePublicKey`. */
  signature: string;
}

export interface AnswerAcceptedReceiptRecord {
  version: typeof ANSWER_ATTESTATION_VERSION;
  kind: "answer.accepted";
  token: AnswerAcceptanceToken;
}

export interface AnswerAttestationSuccessResponse {
  version: typeof ANSWER_ATTESTATION_VERSION;
  requestId: string;
  ok: true;
  token: AnswerAcceptanceToken;
}

export interface AnswerAttestationErrorResponse {
  version: typeof ANSWER_ATTESTATION_VERSION;
  requestId: string | null;
  ok: false;
  error: {
    code: string;
    message: string;
    recoverable: boolean;
  };
}

export type AnswerAttestationResponse =
  | AnswerAttestationSuccessResponse
  | AnswerAttestationErrorResponse;

export class AnswerAttestationValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "AnswerAttestationValidationError";
  }
}

function fail(path: string, reason: string): never {
  throw new AnswerAttestationValidationError(`${path} ${reason}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(path, "must be a plain object");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    fail(path, `must contain exactly: ${expected.join(", ")}`);
  }
}

function text(value: unknown, path: string, maximum: number): string {
  if (typeof value !== "string" || !value || value.length > maximum || value.normalize("NFC") !== value) {
    fail(path, `must be non-empty NFC text of at most ${maximum} characters`);
  }
  return value;
}

function identifier(value: unknown, path: string, maximum = 256, minimum = 1): string {
  const result = text(value, path, maximum);
  if (result.length < minimum || !IDENTIFIER.test(result)) fail(path, "is not a valid identifier");
  return result;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) fail(path, `must be a safe integer of at least ${minimum}`);
  return Number(value);
}

function hex(value: unknown, path: string, pattern: RegExp, bytes: number): string {
  if (typeof value !== "string" || !pattern.test(value)) fail(path, `must be ${bytes}-byte lowercase hex`);
  return value;
}

function parseSubmission(value: unknown, path: string): SignedAnswerSubmission {
  const input = object(value, path);
  exactKeys(input, [
    "version",
    "requestId",
    "answerId",
    "callId",
    "userId",
    "optionId",
    "submittedAt",
    "identityPublicKey",
    "signature",
  ], path);
  if (input.version !== ANSWER_ATTESTATION_VERSION) fail(`${path}.version`, "is unsupported");
  return {
    version: ANSWER_ATTESTATION_VERSION,
    requestId: identifier(input.requestId, `${path}.requestId`, 128, 8),
    answerId: identifier(input.answerId, `${path}.answerId`, 128, 3),
    callId: identifier(input.callId, `${path}.callId`, 256),
    userId: identifier(input.userId, `${path}.userId`, 128),
    optionId: identifier(input.optionId, `${path}.optionId`, 64),
    submittedAt: integer(input.submittedAt, `${path}.submittedAt`),
    identityPublicKey: hex(input.identityPublicKey, `${path}.identityPublicKey`, HEX_32, 32),
    signature: hex(input.signature, `${path}.signature`, HEX_64, 64),
  };
}

export function parseSignedAnswerSubmission(value: unknown): SignedAnswerSubmission {
  return parseSubmission(value, "answer submission");
}

export function answerSubmissionSigningBytes(value: Omit<SignedAnswerSubmission, "signature"> | SignedAnswerSubmission): Uint8Array {
  const normalized = parseSubmission(
    { ...value, signature: "0".repeat(128) },
    "answer submission",
  );
  return encoder.encode(JSON.stringify([
    ANSWER_SUBMISSION_SIGNATURE_CONTEXT,
    normalized.version,
    normalized.requestId,
    normalized.answerId,
    normalized.callId,
    normalized.userId,
    normalized.optionId,
    normalized.submittedAt,
    normalized.identityPublicKey,
  ]));
}

function parseClaims(value: unknown, path: string): AnswerAcceptanceClaims {
  const input = object(value, path);
  exactKeys(input, [
    "version",
    "tokenId",
    "receiptIndex",
    "servicePublicKey",
    "receiptFeedKey",
    "serviceReceivedAt",
    "deadlineAt",
    "fixtureFeedKey",
    "fixtureFeedFork",
    "fixtureFeedLength",
    "fixtureFeedTreeHash",
    "callFeedIndex",
    "fixtureId",
    "locksAt",
    "submission",
  ], path);
  if (input.version !== ANSWER_ATTESTATION_VERSION) fail(`${path}.version`, "is unsupported");
  const submission = parseSubmission(input.submission, `${path}.submission`);
  const receiptIndex = integer(input.receiptIndex, `${path}.receiptIndex`);
  const servicePublicKey = hex(input.servicePublicKey, `${path}.servicePublicKey`, HEX_32, 32);
  const serviceReceivedAt = integer(input.serviceReceivedAt, `${path}.serviceReceivedAt`);
  const locksAt = integer(input.locksAt, `${path}.locksAt`);
  const deadlineAt = integer(input.deadlineAt, `${path}.deadlineAt`);
  if (deadlineAt !== locksAt) {
    fail(`${path}.deadlineAt`, "must equal locksAt");
  }
  const fixtureFeedLength = integer(input.fixtureFeedLength, `${path}.fixtureFeedLength`, 1);
  const callFeedIndex = integer(input.callFeedIndex, `${path}.callFeedIndex`);
  if (callFeedIndex >= fixtureFeedLength) fail(`${path}.callFeedIndex`, "must be inside the committed feed head");
  const tokenId = identifier(input.tokenId, `${path}.tokenId`, 256);
  if (tokenId !== `aat:${servicePublicKey}:${receiptIndex}`) {
    fail(`${path}.tokenId`, "must be derived from servicePublicKey and receiptIndex");
  }
  return {
    version: ANSWER_ATTESTATION_VERSION,
    tokenId,
    receiptIndex,
    servicePublicKey,
    receiptFeedKey: hex(input.receiptFeedKey, `${path}.receiptFeedKey`, HEX_32, 32),
    serviceReceivedAt,
    deadlineAt,
    fixtureFeedKey: hex(input.fixtureFeedKey, `${path}.fixtureFeedKey`, HEX_32, 32),
    fixtureFeedFork: integer(input.fixtureFeedFork, `${path}.fixtureFeedFork`),
    fixtureFeedLength,
    fixtureFeedTreeHash: hex(input.fixtureFeedTreeHash, `${path}.fixtureFeedTreeHash`, HEX_32, 32),
    callFeedIndex,
    fixtureId: identifier(input.fixtureId, `${path}.fixtureId`, 256),
    locksAt,
    submission,
  };
}

export function parseAnswerAcceptanceClaims(value: unknown): AnswerAcceptanceClaims {
  return parseClaims(value, "answer acceptance claims");
}

export function answerAcceptanceSigningBytes(value: AnswerAcceptanceClaims): Uint8Array {
  const claims = parseClaims(value, "answer acceptance claims");
  const submission = claims.submission;
  return encoder.encode(JSON.stringify([
    ANSWER_ACCEPTANCE_SIGNATURE_CONTEXT,
    claims.version,
    claims.tokenId,
    claims.receiptIndex,
    claims.servicePublicKey,
    claims.receiptFeedKey,
    claims.serviceReceivedAt,
    claims.deadlineAt,
    claims.fixtureFeedKey,
    claims.fixtureFeedFork,
    claims.fixtureFeedLength,
    claims.fixtureFeedTreeHash,
    claims.callFeedIndex,
    claims.fixtureId,
    claims.locksAt,
    submission.version,
    submission.requestId,
    submission.answerId,
    submission.callId,
    submission.userId,
    submission.optionId,
    submission.submittedAt,
    submission.identityPublicKey,
    submission.signature,
  ]));
}

export function parseAnswerAcceptanceToken(value: unknown): AnswerAcceptanceToken {
  const input = object(value, "answer acceptance token");
  exactKeys(input, ["claims", "signature"], "answer acceptance token");
  return {
    claims: parseClaims(input.claims, "answer acceptance token.claims"),
    signature: hex(input.signature, "answer acceptance token.signature", HEX_64, 64),
  };
}

export function parseAnswerAcceptedReceiptRecord(value: unknown): AnswerAcceptedReceiptRecord {
  const input = object(value, "answer receipt record");
  exactKeys(input, ["version", "kind", "token"], "answer receipt record");
  if (input.version !== ANSWER_ATTESTATION_VERSION) fail("answer receipt record.version", "is unsupported");
  if (input.kind !== "answer.accepted") fail("answer receipt record.kind", "is unsupported");
  return {
    version: ANSWER_ATTESTATION_VERSION,
    kind: "answer.accepted",
    token: parseAnswerAcceptanceToken(input.token),
  };
}

export function parseAnswerAttestationResponse(value: unknown): AnswerAttestationResponse {
  const input = object(value, "answer attestation response");
  if (input.version !== ANSWER_ATTESTATION_VERSION) fail("answer attestation response.version", "is unsupported");
  if (input.ok === true) {
    exactKeys(input, ["version", "requestId", "ok", "token"], "answer attestation response");
    const token = parseAnswerAcceptanceToken(input.token);
    const requestId = identifier(input.requestId, "answer attestation response.requestId", 128, 8);
    if (requestId !== token.claims.submission.requestId) {
      fail("answer attestation response.requestId", "must match the accepted submission");
    }
    return { version: ANSWER_ATTESTATION_VERSION, requestId, ok: true, token };
  }
  if (input.ok === false) {
    exactKeys(input, ["version", "requestId", "ok", "error"], "answer attestation response");
    const error = object(input.error, "answer attestation response.error");
    exactKeys(error, ["code", "message", "recoverable"], "answer attestation response.error");
    if (typeof error.recoverable !== "boolean") fail("answer attestation response.error.recoverable", "must be a boolean");
    return {
      version: ANSWER_ATTESTATION_VERSION,
      requestId: input.requestId === null
        ? null
        : identifier(input.requestId, "answer attestation response.requestId", 128, 8),
      ok: false,
      error: {
        code: identifier(error.code, "answer attestation response.error.code", 80),
        message: text(error.message, "answer attestation response.error.message", 1_024),
        recoverable: error.recoverable,
      },
    };
  }
  fail("answer attestation response.ok", "must be a boolean");
}

function decodeFrame(bytes: Uint8Array, label: string): unknown {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_ANSWER_ATTESTATION_FRAME_BYTES) {
    fail(label, `must be 1-${MAX_ANSWER_ATTESTATION_FRAME_BYTES} bytes`);
  }
  try {
    return JSON.parse(decoder.decode(bytes)) as unknown;
  } catch {
    fail(label, "must contain valid UTF-8 JSON");
  }
}

export function decodeSignedAnswerSubmission(bytes: Uint8Array): SignedAnswerSubmission {
  return parseSignedAnswerSubmission(decodeFrame(bytes, "answer submission frame"));
}

export function encodeSignedAnswerSubmission(value: SignedAnswerSubmission): Uint8Array {
  const normalized = parseSignedAnswerSubmission(value);
  const bytes = encoder.encode(JSON.stringify(normalized));
  if (bytes.byteLength > MAX_ANSWER_ATTESTATION_FRAME_BYTES) fail("answer submission frame", "is too large");
  return bytes;
}

export function decodeAnswerAttestationResponse(bytes: Uint8Array): AnswerAttestationResponse {
  return parseAnswerAttestationResponse(decodeFrame(bytes, "answer attestation response frame"));
}

export function encodeAnswerAttestationResponse(value: AnswerAttestationResponse): Uint8Array {
  const normalized = parseAnswerAttestationResponse(value);
  const bytes = encoder.encode(JSON.stringify(normalized));
  if (bytes.byteLength > MAX_ANSWER_ATTESTATION_FRAME_BYTES) fail("answer attestation response frame", "is too large");
  return bytes;
}

export function decodeAnswerAcceptedReceiptRecord(bytes: Uint8Array): AnswerAcceptedReceiptRecord {
  return parseAnswerAcceptedReceiptRecord(decodeFrame(bytes, "answer receipt block"));
}

export function encodeAnswerAcceptedReceiptRecord(value: AnswerAcceptedReceiptRecord): Uint8Array {
  const normalized = parseAnswerAcceptedReceiptRecord(value);
  const bytes = encoder.encode(JSON.stringify(normalized));
  if (bytes.byteLength > MAX_ANSWER_ATTESTATION_FRAME_BYTES) fail("answer receipt block", "is too large");
  return bytes;
}
