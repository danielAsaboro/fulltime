/**
 * Portable scored-receipt commitments and Merkle proofs.
 *
 * A claim is useful only when it can be reopened against the exact accepted
 * answer token and publisher-signed call/settlement blocks. Anchoring is a
 * separate external observation: an anchor record by itself never earns an
 * "anchored" state.
 */

import {
  answerAcceptanceSigningBytes,
  parseAnswerAcceptanceToken,
  type AnswerAcceptanceToken,
} from "./answer-attestation";
import {
  encodeFixturePlaneRecord,
  parseFixturePlaneRecord,
  type FixtureCallOpenRecord,
  type FixtureCallSettledRecord,
  type FixturePlaneRecord,
} from "./fixture-plane";
import { asAnswerId, asCallId, asUserId } from "./ids";
import { scoreAnswerChoice } from "./result-engine";
import { BASE_CALL_POINTS, MAX_DIFFICULTY_MULTIPLIER, type AnswerScore } from "./scoring";

export const RECEIPT_PROOF_VERSION = 1 as const;
export const MAX_RECEIPT_BATCH_CLAIMS = 4_096;
export const MAX_RECEIPT_PROOF_RECORD_BYTES = 512 * 1024;

const TOKEN_HASH_CONTEXT = "fulltime/accepted-answer-token-hash/v1";
const FIXTURE_RECORD_HASH_CONTEXT = "fulltime/fixture-plane-record-hash/v1";
const CLAIM_HASH_CONTEXT = "fulltime/scored-receipt-claim-hash/v1";
const MERKLE_LEAF_CONTEXT = "fulltime/receipt-merkle-leaf/v1";
const MERKLE_PADDING_CONTEXT = "fulltime/receipt-merkle-padding/v1";
const MERKLE_NODE_CONTEXT = "fulltime/receipt-merkle-node/v1";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const HEX_32 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[\p{L}\p{N}][\p{L}\p{N}._:/-]*$/u;

export interface FixturePlaneFeedHead {
  feedKey: string;
  feedFork: number;
  feedLength: number;
  feedTreeHash: string;
}

export interface FixturePlaneRecordReference extends FixturePlaneFeedHead {
  index: number;
  /** SHA-256 commitment to the normalized fixture-plane block. */
  recordHash: string;
}

export interface ScoredReceiptClaim {
  version: typeof RECEIPT_PROOF_VERSION;
  kind: "receipt.scored";
  acceptedAnswerTokenHash: string;
  callOpen: FixturePlaneRecordReference;
  callSettled: FixturePlaneRecordReference;
  score: AnswerScore;
}

export interface ReceiptBatchRecord {
  version: typeof RECEIPT_PROOF_VERSION;
  kind: "receipt.batch";
  batchId: string;
  merkleRoot: string;
  leafCount: number;
  treeSize: number;
  /** Canonical receipt hashes, strictly sorted and unique. */
  claimHashes: string[];
}

export interface MerkleProofStep {
  side: "left" | "right";
  hash: string;
}

export interface ReceiptInclusionProof {
  version: typeof RECEIPT_PROOF_VERSION;
  kind: "receipt.inclusion";
  batchId: string;
  merkleRoot: string;
  claimHash: string;
  leafIndex: number;
  leafCount: number;
  treeSize: number;
  siblings: MerkleProofStep[];
}

export interface ReceiptAnchorRecord {
  version: typeof RECEIPT_PROOF_VERSION;
  kind: "receipt.anchor";
  batchId: string;
  merkleRoot: string;
  transactionRef: string;
  rootRef: string;
  statValidationRef: string;
}

/** Values read back from the real external transaction/root/stat-validation walk. */
export interface ReceiptAnchorObservation {
  transactionRef: string;
  rootRef: string;
  statValidationRef: string;
  committedRoot: string;
}

export type ReceiptBatchProofState =
  | { state: "proof-pending"; batchId: string; merkleRoot: string }
  | { state: "anchored"; batchId: string; merkleRoot: string; anchor: ReceiptAnchorRecord };

export interface CreateScoredReceiptClaimInput {
  acceptedAnswerToken: AnswerAcceptanceToken;
  callOpenRecord: FixtureCallOpenRecord;
  callOpenReference: FixturePlaneRecordReference;
  callSettledRecord: FixtureCallSettledRecord;
  callSettledReference: FixturePlaneRecordReference;
}

export class ReceiptProofValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptProofValidationError";
  }
}

function fail(path: string, reason: string): never {
  throw new ReceiptProofValidationError(`${path} ${reason}`);
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

function text(value: unknown, path: string, maximum = 1_024, minimum = 1): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    value.normalize("NFC") !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail(path, `must be ${minimum}-${maximum} characters of NFC text without control characters`);
  }
  return value;
}

function identifier(value: unknown, path: string, maximum = 256): string {
  const result = text(value, path, maximum);
  if (!IDENTIFIER.test(result)) fail(path, "is not a valid identifier");
  return result;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    fail(path, `must be a safe integer of at least ${minimum}`);
  }
  return Number(value);
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a finite number from ${minimum} to ${maximum}`);
  }
  return value;
}

function hex32(value: unknown, path: string): string {
  if (typeof value !== "string" || !HEX_32.test(value)) fail(path, "must be 32-byte lowercase hex");
  return value;
}

function parseFeedHead(value: unknown, path: string): FixturePlaneFeedHead {
  const input = object(value, path);
  exactKeys(input, ["feedKey", "feedFork", "feedLength", "feedTreeHash"], path);
  return {
    feedKey: hex32(input.feedKey, `${path}.feedKey`),
    feedFork: integer(input.feedFork, `${path}.feedFork`),
    feedLength: integer(input.feedLength, `${path}.feedLength`, 1),
    feedTreeHash: hex32(input.feedTreeHash, `${path}.feedTreeHash`),
  };
}

export function parseFixturePlaneFeedHead(value: unknown): FixturePlaneFeedHead {
  return parseFeedHead(value, "fixture feed head");
}

function parseReference(value: unknown, path: string): FixturePlaneRecordReference {
  const input = object(value, path);
  exactKeys(input, ["feedKey", "feedFork", "feedLength", "feedTreeHash", "index", "recordHash"], path);
  const head = parseFeedHead(
    {
      feedKey: input.feedKey,
      feedFork: input.feedFork,
      feedLength: input.feedLength,
      feedTreeHash: input.feedTreeHash,
    },
    path,
  );
  const index = integer(input.index, `${path}.index`);
  if (index >= head.feedLength) fail(`${path}.index`, "must be inside the committed feed head");
  return { ...head, index, recordHash: hex32(input.recordHash, `${path}.recordHash`) };
}

export function parseFixturePlaneRecordReference(value: unknown): FixturePlaneRecordReference {
  return parseReference(value, "fixture-plane record reference");
}

function parseScore(value: unknown, path: string): AnswerScore {
  const input = object(value, path);
  exactKeys(input, ["answerId", "callId", "userId", "correct", "points", "multiplier"], path);
  if (typeof input.correct !== "boolean") fail(`${path}.correct`, "must be a boolean");
  const multiplier = finite(input.multiplier, `${path}.multiplier`, 1, MAX_DIFFICULTY_MULTIPLIER);
  const points = integer(input.points, `${path}.points`);
  const expectedPoints = input.correct ? Math.round(BASE_CALL_POINTS * multiplier) : 0;
  if (points !== expectedPoints) fail(`${path}.points`, "must match correctness and multiplier");
  return {
    answerId: identifier(input.answerId, `${path}.answerId`) as AnswerScore["answerId"],
    callId: identifier(input.callId, `${path}.callId`) as AnswerScore["callId"],
    userId: identifier(input.userId, `${path}.userId`) as AnswerScore["userId"],
    correct: input.correct,
    points,
    multiplier,
  };
}

export function parseScoredReceiptClaim(value: unknown): ScoredReceiptClaim {
  const input = object(value, "scored receipt claim");
  exactKeys(
    input,
    ["version", "kind", "acceptedAnswerTokenHash", "callOpen", "callSettled", "score"],
    "scored receipt claim",
  );
  if (input.version !== RECEIPT_PROOF_VERSION) fail("scored receipt claim.version", "is unsupported");
  if (input.kind !== "receipt.scored") fail("scored receipt claim.kind", "is unsupported");
  const callOpen = parseReference(input.callOpen, "scored receipt claim.callOpen");
  const callSettled = parseReference(input.callSettled, "scored receipt claim.callSettled");
  if (callOpen.feedKey !== callSettled.feedKey || callOpen.feedFork !== callSettled.feedFork) {
    fail("scored receipt claim.callSettled", "must reference the same publisher feed and fork as callOpen");
  }
  if (callSettled.feedLength < callOpen.feedLength || callSettled.index <= callOpen.index) {
    fail("scored receipt claim.callSettled", "must commit a later settlement block and non-regressing feed head");
  }
  return {
    version: RECEIPT_PROOF_VERSION,
    kind: "receipt.scored",
    acceptedAnswerTokenHash: hex32(
      input.acceptedAnswerTokenHash,
      "scored receipt claim.acceptedAnswerTokenHash",
    ),
    callOpen,
    callSettled,
    score: parseScore(input.score, "scored receipt claim.score"),
  };
}

function canonicalClaimVector(claim: ScoredReceiptClaim): unknown[] {
  return [
    CLAIM_HASH_CONTEXT,
    claim.version,
    claim.kind,
    claim.acceptedAnswerTokenHash,
    referenceVector(claim.callOpen),
    referenceVector(claim.callSettled),
    [
      claim.score.answerId,
      claim.score.callId,
      claim.score.userId,
      claim.score.correct,
      claim.score.points,
      claim.score.multiplier,
    ],
  ];
}

function referenceVector(reference: FixturePlaneRecordReference): unknown[] {
  return [
    reference.feedKey,
    reference.feedFork,
    reference.feedLength,
    reference.feedTreeHash,
    reference.index,
    reference.recordHash,
  ];
}

export function canonicalScoredReceiptClaimBytes(value: ScoredReceiptClaim): Uint8Array {
  const claim = parseScoredReceiptClaim(value);
  return encoder.encode(JSON.stringify(canonicalClaimVector(claim)));
}

export async function acceptedAnswerTokenHash(value: AnswerAcceptanceToken): Promise<string> {
  const token = parseAnswerAcceptanceToken(value);
  const signingHashInput = bytesToHex(answerAcceptanceSigningBytes(token.claims));
  return sha256(encoder.encode(JSON.stringify([TOKEN_HASH_CONTEXT, signingHashInput, token.signature])));
}

export async function fixturePlaneRecordHash(value: FixturePlaneRecord): Promise<string> {
  const record = parseFixturePlaneRecord(value);
  return sha256(
    encoder.encode(JSON.stringify([FIXTURE_RECORD_HASH_CONTEXT, bytesToHex(encodeFixturePlaneRecord(record))])),
  );
}

export async function createFixturePlaneRecordReference(
  headValue: FixturePlaneFeedHead,
  index: number,
  record: FixturePlaneRecord,
): Promise<FixturePlaneRecordReference> {
  const head = parseFixturePlaneFeedHead(headValue);
  if (!Number.isSafeInteger(index) || index < 0 || index >= head.feedLength) {
    fail("fixture-plane record reference.index", "must be inside the committed feed head");
  }
  return parseFixturePlaneRecordReference({
    ...head,
    index,
    recordHash: await fixturePlaneRecordHash(record),
  });
}

export async function scoredReceiptClaimHash(value: ScoredReceiptClaim): Promise<string> {
  return sha256(canonicalScoredReceiptClaimBytes(value));
}

/**
 * Create a scored claim from source objects. `null` is the honest result for a
 * void settlement or a call that is explicitly unscored.
 */
export async function createScoredReceiptClaim(
  input: CreateScoredReceiptClaimInput,
): Promise<ScoredReceiptClaim | null> {
  const token = parseAnswerAcceptanceToken(input.acceptedAnswerToken);
  const callOpen = requireRecordKind(input.callOpenRecord, "call.open");
  const callSettled = requireRecordKind(input.callSettledRecord, "call.settled");
  const openReference = parseFixturePlaneRecordReference(input.callOpenReference);
  const settledReference = parseFixturePlaneRecordReference(input.callSettledReference);
  const claims = token.claims;
  const submission = claims.submission;

  if (claims.serviceReceivedAt > claims.deadlineAt) {
    fail("accepted answer token", "was accepted after its calibrated deadline");
  }
  if (
    claims.fixtureFeedKey !== openReference.feedKey ||
    claims.fixtureFeedFork !== openReference.feedFork ||
    claims.fixtureFeedLength !== openReference.feedLength ||
    claims.fixtureFeedTreeHash !== openReference.feedTreeHash ||
    claims.callFeedIndex !== openReference.index
  ) {
    fail("call.open reference", "must match the exact signed feed head committed by the acceptance token");
  }
  if (settledReference.feedKey !== openReference.feedKey || settledReference.feedFork !== openReference.feedFork) {
    fail("call.settled reference", "must use the same publisher feed and fork as call.open");
  }
  if (await fixturePlaneRecordHash(callOpen) !== openReference.recordHash) {
    fail("call.open reference.recordHash", "does not match the supplied signed record");
  }
  if (await fixturePlaneRecordHash(callSettled) !== settledReference.recordHash) {
    fail("call.settled reference.recordHash", "does not match the supplied signed record");
  }
  if (
    submission.callId !== callOpen.call.id ||
    claims.fixtureId !== callOpen.call.fixtureId ||
    claims.locksAt !== callOpen.call.locksAt
  ) {
    fail("accepted answer token", "does not bind the supplied call.open record");
  }
  if (
    callSettled.fixtureId !== callOpen.call.fixtureId ||
    callSettled.settlement.callId !== callOpen.call.id
  ) {
    fail("call.settled record", "does not settle the supplied call.open record");
  }

  const score = scoreAnswerChoice(
    {
      id: asAnswerId(submission.answerId),
      callId: asCallId(submission.callId),
      userId: asUserId(submission.userId),
      option: submission.optionId,
    },
    callOpen.call,
    callSettled.settlement,
  );
  if (!score) return null;

  return parseScoredReceiptClaim({
    version: RECEIPT_PROOF_VERSION,
    kind: "receipt.scored",
    acceptedAnswerTokenHash: await acceptedAnswerTokenHash(token),
    callOpen: openReference,
    callSettled: settledReference,
    score,
  });
}

export async function verifyScoredReceiptClaim(
  value: ScoredReceiptClaim,
  sources: CreateScoredReceiptClaimInput,
): Promise<boolean> {
  try {
    const claim = parseScoredReceiptClaim(value);
    const expected = await createScoredReceiptClaim(sources);
    return expected !== null && bytesToHex(canonicalScoredReceiptClaimBytes(claim)) ===
      bytesToHex(canonicalScoredReceiptClaimBytes(expected));
  } catch {
    return false;
  }
}

function requireRecordKind<T extends "call.open" | "call.settled">(
  value: FixturePlaneRecord,
  kind: T,
): Extract<FixturePlaneRecord, { kind: T }> {
  const record = parseFixturePlaneRecord(value);
  if (record.kind !== kind) fail("fixture-plane record.kind", `must be ${kind}`);
  return record as Extract<FixturePlaneRecord, { kind: T }>;
}

export async function createReceiptBatch(claims: readonly ScoredReceiptClaim[]): Promise<ReceiptBatchRecord> {
  if (claims.length < 1 || claims.length > MAX_RECEIPT_BATCH_CLAIMS) {
    fail("receipt batch claims", `must contain 1-${MAX_RECEIPT_BATCH_CLAIMS} claims`);
  }
  const normalizedClaims = claims.map((claim) => parseScoredReceiptClaim(claim));
  if (new Set(normalizedClaims.map((claim) => claim.acceptedAnswerTokenHash)).size !== claims.length) {
    fail("receipt batch claims", "must contain unique accepted answer tokens");
  }
  if (new Set(normalizedClaims.map((claim) => String(claim.score.answerId))).size !== claims.length) {
    fail("receipt batch claims", "must contain unique accepted answers");
  }
  const claimHashes = await Promise.all(normalizedClaims.map((claim) => scoredReceiptClaimHash(claim)));
  claimHashes.sort(compareHex);
  if (new Set(claimHashes).size !== claimHashes.length) fail("receipt batch claims", "must be unique");
  const treeSize = nextPowerOfTwo(claimHashes.length);
  const root = await merkleRoot(claimHashes, treeSize);
  return parseReceiptBatchRecord({
    version: RECEIPT_PROOF_VERSION,
    kind: "receipt.batch",
    batchId: `receipt-batch:${root}`,
    merkleRoot: root,
    leafCount: claimHashes.length,
    treeSize,
    claimHashes,
  });
}

export function parseReceiptBatchRecord(value: unknown): ReceiptBatchRecord {
  const input = object(value, "receipt.batch record");
  exactKeys(
    input,
    ["version", "kind", "batchId", "merkleRoot", "leafCount", "treeSize", "claimHashes"],
    "receipt.batch record",
  );
  if (input.version !== RECEIPT_PROOF_VERSION) fail("receipt.batch record.version", "is unsupported");
  if (input.kind !== "receipt.batch") fail("receipt.batch record.kind", "is unsupported");
  const merkleRoot = hex32(input.merkleRoot, "receipt.batch record.merkleRoot");
  const batchId = identifier(input.batchId, "receipt.batch record.batchId");
  if (batchId !== `receipt-batch:${merkleRoot}`) fail("receipt.batch record.batchId", "must be derived from merkleRoot");
  const leafCount = integer(input.leafCount, "receipt.batch record.leafCount", 1);
  if (leafCount > MAX_RECEIPT_BATCH_CLAIMS) {
    fail("receipt.batch record.leafCount", `must be at most ${MAX_RECEIPT_BATCH_CLAIMS}`);
  }
  const treeSize = integer(input.treeSize, "receipt.batch record.treeSize", 1);
  if (treeSize !== nextPowerOfTwo(leafCount)) {
    fail("receipt.batch record.treeSize", "must be the minimal power-of-two padding for leafCount");
  }
  if (!Array.isArray(input.claimHashes) || input.claimHashes.length !== leafCount) {
    fail("receipt.batch record.claimHashes", "must contain exactly leafCount hashes");
  }
  const claimHashes = input.claimHashes.map((hash, index) =>
    hex32(hash, `receipt.batch record.claimHashes[${index}]`));
  for (let index = 1; index < claimHashes.length; index += 1) {
    const previous = claimHashes[index - 1]!;
    const current = claimHashes[index]!;
    if (previous >= current) {
      fail("receipt.batch record.claimHashes", "must be strictly sorted and unique");
    }
  }
  return {
    version: RECEIPT_PROOF_VERSION,
    kind: "receipt.batch",
    batchId,
    merkleRoot,
    leafCount,
    treeSize,
    claimHashes,
  };
}

export async function verifyReceiptBatch(value: ReceiptBatchRecord): Promise<boolean> {
  try {
    const batch = parseReceiptBatchRecord(value);
    return await merkleRoot(batch.claimHashes, batch.treeSize) === batch.merkleRoot;
  } catch {
    return false;
  }
}

export async function createReceiptInclusionProof(
  batchValue: ReceiptBatchRecord,
  claimValue: ScoredReceiptClaim,
): Promise<ReceiptInclusionProof> {
  const batch = parseReceiptBatchRecord(batchValue);
  if (!await verifyReceiptBatch(batch)) fail("receipt.batch record.merkleRoot", "does not match its claims");
  const claimHash = await scoredReceiptClaimHash(claimValue);
  const leafIndex = batch.claimHashes.indexOf(claimHash);
  if (leafIndex < 0) fail("receipt inclusion claim", "is not present in the batch");
  let level = await merkleLeaves(batch.claimHashes, batch.treeSize);
  let index = leafIndex;
  const siblings: MerkleProofStep[] = [];
  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    siblings.push({ side: index % 2 === 0 ? "right" : "left", hash: level[siblingIndex]! });
    level = await merkleParentLevel(level);
    index = Math.floor(index / 2);
  }
  return parseReceiptInclusionProof({
    version: RECEIPT_PROOF_VERSION,
    kind: "receipt.inclusion",
    batchId: batch.batchId,
    merkleRoot: batch.merkleRoot,
    claimHash,
    leafIndex,
    leafCount: batch.leafCount,
    treeSize: batch.treeSize,
    siblings,
  });
}

export function parseReceiptInclusionProof(value: unknown): ReceiptInclusionProof {
  const input = object(value, "receipt inclusion proof");
  exactKeys(
    input,
    ["version", "kind", "batchId", "merkleRoot", "claimHash", "leafIndex", "leafCount", "treeSize", "siblings"],
    "receipt inclusion proof",
  );
  if (input.version !== RECEIPT_PROOF_VERSION) fail("receipt inclusion proof.version", "is unsupported");
  if (input.kind !== "receipt.inclusion") fail("receipt inclusion proof.kind", "is unsupported");
  const leafCount = integer(input.leafCount, "receipt inclusion proof.leafCount", 1);
  if (leafCount > MAX_RECEIPT_BATCH_CLAIMS) {
    fail("receipt inclusion proof.leafCount", `must be at most ${MAX_RECEIPT_BATCH_CLAIMS}`);
  }
  const treeSize = integer(input.treeSize, "receipt inclusion proof.treeSize", 1);
  if (treeSize !== nextPowerOfTwo(leafCount)) {
    fail("receipt inclusion proof.treeSize", "must be the minimal power-of-two padding for leafCount");
  }
  const leafIndex = integer(input.leafIndex, "receipt inclusion proof.leafIndex");
  if (leafIndex >= leafCount) fail("receipt inclusion proof.leafIndex", "must identify a real claim leaf");
  if (!Array.isArray(input.siblings) || input.siblings.length !== Math.log2(treeSize)) {
    fail("receipt inclusion proof.siblings", "must contain one sibling for every tree level");
  }
  const siblings = input.siblings.map((step, level) => {
    const decoded = object(step, `receipt inclusion proof.siblings[${level}]`);
    exactKeys(decoded, ["side", "hash"], `receipt inclusion proof.siblings[${level}]`);
    const expectedSide = Math.floor(leafIndex / (2 ** level)) % 2 === 0 ? "right" : "left";
    if (decoded.side !== expectedSide) {
      fail(`receipt inclusion proof.siblings[${level}].side`, `must be ${expectedSide}`);
    }
    return {
      side: expectedSide,
      hash: hex32(decoded.hash, `receipt inclusion proof.siblings[${level}].hash`),
    } satisfies MerkleProofStep;
  });
  return {
    version: RECEIPT_PROOF_VERSION,
    kind: "receipt.inclusion",
    batchId: identifier(input.batchId, "receipt inclusion proof.batchId"),
    merkleRoot: hex32(input.merkleRoot, "receipt inclusion proof.merkleRoot"),
    claimHash: hex32(input.claimHash, "receipt inclusion proof.claimHash"),
    leafIndex,
    leafCount,
    treeSize,
    siblings,
  };
}

export async function verifyReceiptInclusionProof(
  batchValue: ReceiptBatchRecord,
  proofValue: ReceiptInclusionProof,
  claimValue: ScoredReceiptClaim,
): Promise<boolean> {
  try {
    const batch = parseReceiptBatchRecord(batchValue);
    const proof = parseReceiptInclusionProof(proofValue);
    if (!await verifyReceiptBatch(batch)) return false;
    const claimHash = await scoredReceiptClaimHash(claimValue);
    if (
      proof.batchId !== batch.batchId ||
      proof.merkleRoot !== batch.merkleRoot ||
      proof.leafCount !== batch.leafCount ||
      proof.treeSize !== batch.treeSize ||
      proof.claimHash !== claimHash ||
      batch.claimHashes[proof.leafIndex] !== claimHash
    ) return false;
    let current = await merkleClaimLeaf(claimHash);
    for (const step of proof.siblings) {
      current = step.side === "left"
        ? await merkleNode(step.hash, current)
        : await merkleNode(current, step.hash);
    }
    return current === batch.merkleRoot;
  } catch {
    return false;
  }
}

export function parseReceiptAnchorRecord(value: unknown): ReceiptAnchorRecord {
  const input = object(value, "receipt.anchor record");
  exactKeys(
    input,
    ["version", "kind", "batchId", "merkleRoot", "transactionRef", "rootRef", "statValidationRef"],
    "receipt.anchor record",
  );
  if (input.version !== RECEIPT_PROOF_VERSION) fail("receipt.anchor record.version", "is unsupported");
  if (input.kind !== "receipt.anchor") fail("receipt.anchor record.kind", "is unsupported");
  const merkleRoot = hex32(input.merkleRoot, "receipt.anchor record.merkleRoot");
  const batchId = identifier(input.batchId, "receipt.anchor record.batchId");
  if (batchId !== `receipt-batch:${merkleRoot}`) {
    fail("receipt.anchor record.batchId", "must be derived from merkleRoot");
  }
  return {
    version: RECEIPT_PROOF_VERSION,
    kind: "receipt.anchor",
    batchId,
    merkleRoot,
    transactionRef: text(input.transactionRef, "receipt.anchor record.transactionRef", 512, 8),
    rootRef: text(input.rootRef, "receipt.anchor record.rootRef", 512, 8),
    statValidationRef: text(input.statValidationRef, "receipt.anchor record.statValidationRef", 512, 8),
  };
}

function parseAnchorObservation(value: unknown): ReceiptAnchorObservation {
  const input = object(value, "receipt anchor observation");
  exactKeys(input, ["transactionRef", "rootRef", "statValidationRef", "committedRoot"], "receipt anchor observation");
  return {
    transactionRef: text(input.transactionRef, "receipt anchor observation.transactionRef", 512, 8),
    rootRef: text(input.rootRef, "receipt anchor observation.rootRef", 512, 8),
    statValidationRef: text(input.statValidationRef, "receipt anchor observation.statValidationRef", 512, 8),
    committedRoot: hex32(input.committedRoot, "receipt anchor observation.committedRoot"),
  };
}

/** An anchor record alone is insufficient; all external observations are mandatory. */
export async function verifyReceiptAnchor(
  batchValue: ReceiptBatchRecord,
  anchorValue: ReceiptAnchorRecord,
  observationValue?: ReceiptAnchorObservation,
): Promise<boolean> {
  try {
    if (!observationValue) return false;
    const batch = parseReceiptBatchRecord(batchValue);
    const anchor = parseReceiptAnchorRecord(anchorValue);
    const observation = parseAnchorObservation(observationValue);
    if (!await verifyReceiptBatch(batch)) return false;
    return anchor.batchId === batch.batchId &&
      anchor.merkleRoot === batch.merkleRoot &&
      observation.committedRoot === batch.merkleRoot &&
      observation.transactionRef === anchor.transactionRef &&
      observation.rootRef === anchor.rootRef &&
      observation.statValidationRef === anchor.statValidationRef;
  } catch {
    return false;
  }
}

export async function receiptBatchProofState(
  batchValue: ReceiptBatchRecord,
  anchorValue?: ReceiptAnchorRecord,
  observationValue?: ReceiptAnchorObservation,
): Promise<ReceiptBatchProofState> {
  const batch = parseReceiptBatchRecord(batchValue);
  if (
    anchorValue &&
    observationValue &&
    await verifyReceiptAnchor(batch, anchorValue, observationValue)
  ) {
    return {
      state: "anchored",
      batchId: batch.batchId,
      merkleRoot: batch.merkleRoot,
      anchor: parseReceiptAnchorRecord(anchorValue),
    };
  }
  return { state: "proof-pending", batchId: batch.batchId, merkleRoot: batch.merkleRoot };
}

export function encodeReceiptBatchRecord(value: ReceiptBatchRecord): Uint8Array {
  return encodeRecord(parseReceiptBatchRecord(value), "receipt.batch record");
}

export function decodeReceiptBatchRecord(bytes: Uint8Array): ReceiptBatchRecord {
  return parseReceiptBatchRecord(decodeRecord(bytes, "receipt.batch record"));
}

export function encodeReceiptAnchorRecord(value: ReceiptAnchorRecord): Uint8Array {
  return encodeRecord(parseReceiptAnchorRecord(value), "receipt.anchor record");
}

export function decodeReceiptAnchorRecord(bytes: Uint8Array): ReceiptAnchorRecord {
  return parseReceiptAnchorRecord(decodeRecord(bytes, "receipt.anchor record"));
}

function encodeRecord(value: unknown, path: string): Uint8Array {
  const bytes = encoder.encode(JSON.stringify(value));
  if (bytes.byteLength > MAX_RECEIPT_PROOF_RECORD_BYTES) fail(path, "is too large");
  return bytes;
}

function decodeRecord(bytes: Uint8Array, path: string): unknown {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RECEIPT_PROOF_RECORD_BYTES) {
    fail(path, `must be 1-${MAX_RECEIPT_PROOF_RECORD_BYTES} bytes`);
  }
  try {
    return JSON.parse(decoder.decode(bytes)) as unknown;
  } catch {
    fail(path, "must contain valid UTF-8 JSON");
  }
}

async function merkleRoot(claimHashes: readonly string[], treeSize: number): Promise<string> {
  let level = await merkleLeaves(claimHashes, treeSize);
  while (level.length > 1) level = await merkleParentLevel(level);
  return level[0]!;
}

async function merkleLeaves(claimHashes: readonly string[], treeSize: number): Promise<string[]> {
  const leaves = await Promise.all(claimHashes.map((hash) => merkleClaimLeaf(hash)));
  for (let index = claimHashes.length; index < treeSize; index += 1) {
    leaves.push(await sha256(encoder.encode(JSON.stringify([MERKLE_PADDING_CONTEXT, index]))));
  }
  return leaves;
}

async function merkleClaimLeaf(claimHash: string): Promise<string> {
  return sha256(encoder.encode(JSON.stringify([MERKLE_LEAF_CONTEXT, hex32(claimHash, "claim hash")])));
}

async function merkleParentLevel(level: readonly string[]): Promise<string[]> {
  if (level.length % 2 !== 0) fail("Merkle level", "must be power-of-two padded");
  const parents: Promise<string>[] = [];
  for (let index = 0; index < level.length; index += 2) {
    parents.push(merkleNode(level[index]!, level[index + 1]!));
  }
  return Promise.all(parents);
}

async function merkleNode(left: string, right: string): Promise<string> {
  return sha256(encoder.encode(JSON.stringify([
    MERKLE_NODE_CONTEXT,
    hex32(left, "left Merkle node"),
    hex32(right, "right Merkle node"),
  ])));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function compareHex(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
