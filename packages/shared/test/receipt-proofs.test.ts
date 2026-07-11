import assert from "node:assert/strict";
import test from "node:test";

import {
  RECEIPT_PROOF_VERSION,
  asCallId,
  asFeedMessageId,
  asFeedTimestamp,
  asFixtureId,
  asSettlementId,
  asWallClock,
  createFixturePlaneRecordReference,
  createReceiptBatch,
  createReceiptInclusionProof,
  createScoredReceiptClaim,
  decodeReceiptAnchorRecord,
  decodeReceiptBatchRecord,
  encodeReceiptAnchorRecord,
  encodeReceiptBatchRecord,
  parseReceiptAnchorRecord,
  parseReceiptBatchRecord,
  parseScoredReceiptClaim,
  receiptBatchProofState,
  scoredReceiptClaimHash,
  verifyReceiptAnchor,
  verifyReceiptBatch,
  verifyReceiptInclusionProof,
  verifyScoredReceiptClaim,
  type AnswerAcceptanceToken,
  type CreateScoredReceiptClaimInput,
  type FixtureCallOpenRecord,
  type FixtureCallSettledRecord,
  type FixturePlaneFeedHead,
  type ReceiptAnchorObservation,
  type ReceiptAnchorRecord,
  type ScoredReceiptClaim,
} from "../src/index";

const fixtureId = asFixtureId("fixture:proof:1");
const callId = asCallId("call:fixture:proof:1:opening-goal");

const callOpenRecord: FixtureCallOpenRecord = {
  version: 1,
  kind: "call.open",
  publishedAt: asWallClock(110),
  call: {
    id: callId,
    fixtureId,
    roomId: null,
    template: "window",
    spec: { kind: "window", event: "goal", withinMinutes: 10 },
    prompt: "A goal in the next ten minutes?",
    options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
    openedAt: asFeedTimestamp(100),
    locksAt: asFeedTimestamp(200),
    settlesBy: asFeedTimestamp(700),
    scored: true,
    status: "open",
    difficulty: 0.25,
  },
};

const callSettledRecord: FixtureCallSettledRecord = {
  version: 1,
  kind: "call.settled",
  publishedAt: asWallClock(310),
  fixtureId,
  settlement: {
    id: asSettlementId(`settlement:${callId}`),
    callId,
    outcome: { status: "settled", winningOption: "yes" },
    settledAtFeedTs: asFeedTimestamp(300),
    decidingMessageIds: [asFeedMessageId("fixture:proof:1:goal:1")],
  },
};

const callHead: FixturePlaneFeedHead = {
  feedKey: "44".repeat(32),
  feedFork: 0,
  feedLength: 10,
  feedTreeHash: "55".repeat(32),
};

const settledHead: FixturePlaneFeedHead = {
  feedKey: callHead.feedKey,
  feedFork: 0,
  feedLength: 14,
  feedTreeHash: "77".repeat(32),
};

function fixedHex(seed: number, bytes: number): string {
  return seed.toString(16).padStart(2, "0").repeat(bytes);
}

function token(index: number, optionId = "yes"): AnswerAcceptanceToken {
  const servicePublicKey = "33".repeat(32);
  return {
    claims: {
      version: 2,
      tokenId: `aat:${servicePublicKey}:${index}`,
      receiptIndex: index,
      servicePublicKey,
      receiptFeedKey: "22".repeat(32),
      serviceReceivedAt: 180,
      deadlineAt: 200,
      fixtureFeedKey: callHead.feedKey,
      fixtureFeedFork: callHead.feedFork,
      fixtureFeedLength: callHead.feedLength,
      fixtureFeedTreeHash: callHead.feedTreeHash,
      callFeedIndex: 8,
      fixtureId,
      locksAt: 200,
      submission: {
        version: 2,
        requestId: `request:${index}:12345678`,
        answerId: `answer:${index}`,
        callId,
        userId: `peer:${index}`,
        optionId,
        submittedAt: 150,
        identityPublicKey: fixedHex(index + 1, 32),
        signature: fixedHex(index + 2, 64),
      },
    },
    signature: fixedHex(index + 3, 64),
  };
}

async function sources(
  index: number,
  optionId = "yes",
  openRecord = callOpenRecord,
  settledRecord = callSettledRecord,
): Promise<CreateScoredReceiptClaimInput> {
  return {
    acceptedAnswerToken: token(index, optionId),
    callOpenRecord: openRecord,
    callOpenReference: await createFixturePlaneRecordReference(callHead, 8, openRecord),
    callSettledRecord: settledRecord,
    callSettledReference: await createFixturePlaneRecordReference(settledHead, 12, settledRecord),
  };
}

async function claim(index: number, optionId = "yes"): Promise<ScoredReceiptClaim> {
  const result = await createScoredReceiptClaim(await sources(index, optionId));
  assert.ok(result);
  return result;
}

test("scored receipt claims bind the accepted token and exact signed call records", async () => {
  const source = await sources(1);
  const result = await createScoredReceiptClaim(source);
  assert.ok(result);
  assert.deepEqual(result.score, {
    answerId: "answer:1",
    callId,
    userId: "peer:1",
    correct: true,
    points: 400,
    multiplier: 4,
  });
  assert.equal(await verifyScoredReceiptClaim(result, source), true);

  const reordered = Object.fromEntries(Object.entries(result).reverse()) as unknown as ScoredReceiptClaim;
  assert.equal(await scoredReceiptClaimHash(reordered), await scoredReceiptClaimHash(result));
  assert.throws(() => parseScoredReceiptClaim({ ...result, ignored: true }), /must contain exactly/);

  assert.equal(await verifyScoredReceiptClaim(
    { ...result, score: { ...result.score, points: 0 } },
    source,
  ), false);
  assert.equal(await verifyScoredReceiptClaim(result, {
    ...source,
    acceptedAnswerToken: { ...source.acceptedAnswerToken, signature: "aa".repeat(64) },
  }), false);
  assert.equal(await verifyScoredReceiptClaim(result, {
    ...source,
    callOpenRecord: {
      ...source.callOpenRecord,
      call: { ...source.callOpenRecord.call, prompt: "Tampered prompt?" },
    },
  }), false);
  assert.equal(await verifyScoredReceiptClaim(result, {
    ...source,
    callSettledRecord: {
      ...source.callSettledRecord,
      settlement: {
        ...source.callSettledRecord.settlement,
        outcome: { status: "settled", winningOption: "no" },
      },
    },
  }), false);
});

test("void and explicitly unscored calls never mint scored receipt claims", async () => {
  const voidSettlement: FixtureCallSettledRecord = {
    ...callSettledRecord,
    settlement: {
      ...callSettledRecord.settlement,
      outcome: { status: "void", reason: "feed-gap" },
      settledAtFeedTs: null,
      decidingMessageIds: [],
    },
  };
  assert.equal(await createScoredReceiptClaim(await sources(2, "yes", callOpenRecord, voidSettlement)), null);

  const unscoredCall: FixtureCallOpenRecord = {
    ...callOpenRecord,
    call: { ...callOpenRecord.call, scored: false },
  };
  assert.equal(await createScoredReceiptClaim(await sources(3, "yes", unscoredCall)), null);
});

test("receipt batches sort, deduplicate, and power-of-two pad odd leaf counts", async () => {
  const claims = [await claim(6, "no"), await claim(4), await claim(5)];
  const batch = await createReceiptBatch(claims);
  assert.equal(batch.version, RECEIPT_PROOF_VERSION);
  assert.equal(batch.leafCount, 3);
  assert.equal(batch.treeSize, 4);
  assert.deepEqual(batch.claimHashes, [...batch.claimHashes].sort());
  assert.equal(await verifyReceiptBatch(batch), true);

  const reordered = await createReceiptBatch([...claims].reverse());
  assert.equal(reordered.merkleRoot, batch.merkleRoot);
  assert.deepEqual(decodeReceiptBatchRecord(encodeReceiptBatchRecord(batch)), batch);

  for (const item of claims) {
    const proof = await createReceiptInclusionProof(batch, item);
    assert.equal(await verifyReceiptInclusionProof(batch, proof, item), true);
  }
  await assert.rejects(createReceiptBatch([claims[0]!, claims[0]!]), /unique accepted answer tokens/);

  const repeatedSource = await sources(12);
  const repeated = await createScoredReceiptClaim(repeatedSource);
  assert.ok(repeated);
  const laterHead = { ...settledHead, feedLength: 15, feedTreeHash: "88".repeat(32) };
  const repeatedAtLaterHead = await createScoredReceiptClaim({
    ...repeatedSource,
    callSettledReference: await createFixturePlaneRecordReference(
      laterHead,
      12,
      repeatedSource.callSettledRecord,
    ),
  });
  assert.ok(repeatedAtLaterHead);
  assert.notEqual(await scoredReceiptClaimHash(repeated), await scoredReceiptClaimHash(repeatedAtLaterHead));
  await assert.rejects(
    createReceiptBatch([repeated, repeatedAtLaterHead]),
    /unique accepted answer tokens/,
  );
});

test("wrong batch roots, proof paths, and claims do not verify", async () => {
  const first = await claim(7);
  const second = await claim(8, "no");
  const third = await claim(9);
  const batch = await createReceiptBatch([first, second, third]);
  const proof = await createReceiptInclusionProof(batch, first);

  const wrongRoot = "00".repeat(32);
  const alteredBatch = {
    ...batch,
    batchId: `receipt-batch:${wrongRoot}`,
    merkleRoot: wrongRoot,
  };
  assert.equal(await verifyReceiptBatch(alteredBatch), false);
  assert.equal(await verifyReceiptInclusionProof(alteredBatch, proof, first), false);

  const badProof = structuredClone(proof);
  badProof.siblings[0]!.hash = "ff".repeat(32);
  assert.equal(await verifyReceiptInclusionProof(batch, badProof, first), false);
  assert.equal(await verifyReceiptInclusionProof(batch, proof, second), false);

  assert.throws(
    () => parseReceiptBatchRecord({ ...batch, claimHashes: [...batch.claimHashes].reverse() }),
    /strictly sorted/,
  );
});

test("anchor state remains proof-pending until a real external reference walk matches", async () => {
  const batch = await createReceiptBatch([await claim(10), await claim(11, "no")]);
  const anchor: ReceiptAnchorRecord = {
    version: 1,
    kind: "receipt.anchor",
    batchId: batch.batchId,
    merkleRoot: batch.merkleRoot,
    transactionRef: "chain-tx:real-fixture-reference",
    rootRef: "chain-root:batch-account-slot",
    statValidationRef: "txline-stat-validation:fixture-proof",
  };
  const observation: ReceiptAnchorObservation = {
    transactionRef: anchor.transactionRef,
    rootRef: anchor.rootRef,
    statValidationRef: anchor.statValidationRef,
    committedRoot: batch.merkleRoot,
  };

  assert.deepEqual(decodeReceiptAnchorRecord(encodeReceiptAnchorRecord(anchor)), anchor);
  assert.deepEqual(await receiptBatchProofState(batch), {
    state: "proof-pending",
    batchId: batch.batchId,
    merkleRoot: batch.merkleRoot,
  });
  assert.equal(await verifyReceiptAnchor(batch, anchor), false);
  assert.equal((await receiptBatchProofState(batch, anchor)).state, "proof-pending");
  assert.equal(await verifyReceiptAnchor(batch, anchor, observation), true);
  assert.equal((await receiptBatchProofState(batch, anchor, observation)).state, "anchored");

  assert.equal(await verifyReceiptAnchor(batch, anchor, {
    ...observation,
    committedRoot: "aa".repeat(32),
  }), false);
  assert.equal(await verifyReceiptAnchor(batch, anchor, {
    ...observation,
    transactionRef: "chain-tx:different-reference",
  }), false);
  assert.throws(
    () => parseReceiptAnchorRecord({ ...anchor, statValidationRef: "" }),
    /statValidationRef/,
  );
  assert.throws(
    () => parseReceiptAnchorRecord({ ...anchor, syntheticSuccess: true }),
    /must contain exactly/,
  );
});
