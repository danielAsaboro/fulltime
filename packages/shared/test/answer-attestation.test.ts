import assert from "node:assert/strict";
import test from "node:test";

import {
  answerAcceptanceSigningBytes,
  answerSubmissionSigningBytes,
  decodeAnswerAcceptedReceiptRecord,
  encodeAnswerAcceptedReceiptRecord,
  parseSignedAnswerSubmission,
  type AnswerAcceptedReceiptRecord,
  type SignedAnswerSubmission,
} from "../src/answer-attestation.js";

const submission: SignedAnswerSubmission = {
  version: 2,
  requestId: "request:12345678",
  answerId: "answer:123",
  callId: "call:123",
  userId: "peer:123",
  optionId: "home",
  submittedAt: 1_750_000_000_000,
  identityPublicKey: "11".repeat(32),
  signature: "22".repeat(64),
};

test("answer submission signing bytes are canonical and reject extra fields", () => {
  const reordered = Object.fromEntries(Object.entries(submission).reverse()) as unknown as SignedAnswerSubmission;
  assert.deepEqual(answerSubmissionSigningBytes(reordered), answerSubmissionSigningBytes(submission));
  assert.throws(
    () => parseSignedAnswerSubmission({ ...submission, ignored: true }),
    /must contain exactly/,
  );
  assert.throws(
    () => parseSignedAnswerSubmission({ ...submission, obsoleteField: 0 }),
    /must contain exactly/,
  );
});

test("acceptance receipts round-trip and freeze the signed call lock time", () => {
  const record: AnswerAcceptedReceiptRecord = {
    version: 2,
    kind: "answer.accepted",
    token: {
      claims: {
        version: 2,
        tokenId: `aat:${"33".repeat(32)}:7`,
        receiptIndex: 7,
        servicePublicKey: "33".repeat(32),
        receiptFeedKey: "77".repeat(32),
        serviceReceivedAt: 1_750_000_001_000,
        deadlineAt: 1_750_000_000_000,
        fixtureFeedKey: "44".repeat(32),
        fixtureFeedFork: 0,
        fixtureFeedLength: 12,
        fixtureFeedTreeHash: "55".repeat(32),
        callFeedIndex: 8,
        fixtureId: "fixture:1",
        locksAt: 1_750_000_000_000,
        submission,
      },
      signature: "66".repeat(64),
    },
  };
  const decoded = decodeAnswerAcceptedReceiptRecord(encodeAnswerAcceptedReceiptRecord(record));
  assert.deepEqual(decoded, record);
  assert.deepEqual(
    answerAcceptanceSigningBytes(decoded.token.claims),
    answerAcceptanceSigningBytes(record.token.claims),
  );
  assert.throws(
    () => encodeAnswerAcceptedReceiptRecord({
      ...record,
      token: {
        ...record.token,
        claims: { ...record.token.claims, deadlineAt: record.token.claims.deadlineAt + 1 },
      },
    }),
    /must equal locksAt/,
  );
});
