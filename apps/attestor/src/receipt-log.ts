import {
  ANSWER_ATTESTATION_VERSION,
  answerAcceptanceSigningBytes,
  decodeAnswerAcceptedReceiptRecord,
  encodeAnswerAcceptedReceiptRecord,
  type AnswerAcceptanceClaims,
  type AnswerAcceptanceToken,
  type SignedAnswerSubmission,
} from "../../../packages/shared/src/answer-attestation.js";

import { AttestorError } from "./errors.js";
import { b4a, hypercoreCrypto, type HypercoreLike } from "./holepunch.js";
import { userIdFromIdentityPublicKey, verifyAcceptanceToken, verifyMemberSubmission } from "./identity.js";

const RECEIPT_CORE_NAME = "fulltime-answer-attestor-receipts-v1";

export interface AcceptanceFacts {
  serviceReceivedAt: number;
  deadlineAt: number;
  fixtureFeedKey: string;
  fixtureFeedFork: number;
  fixtureFeedLength: number;
  fixtureFeedTreeHash: string;
  callFeedIndex: number;
  fixtureId: string;
  locksAt: number;
}

export class ReceiptLog {
  readonly core: HypercoreLike;
  servicePublicKey = "";
  receiptFeedKey = "";

  private readonly requestIds = new Set<string>();
  private readonly answerIds = new Set<string>();
  private readonly memberCalls = new Set<string>();

  static coreName(): string {
    return RECEIPT_CORE_NAME;
  }

  constructor(core: HypercoreLike) {
    this.core = core;
  }

  async open(expectedPublicKey?: string): Promise<void> {
    await this.core.ready();
    if (!this.core.keyPair?.secretKey || this.core.keyPair.secretKey.byteLength !== 64) {
      throw new Error("Answer receipt Hypercore is not writable");
    }
    this.receiptFeedKey = b4a.toString(this.core.key, "hex");
    this.servicePublicKey = b4a.toString(this.core.keyPair.publicKey, "hex");
    if (expectedPublicKey && expectedPublicKey !== this.servicePublicKey) {
      throw new Error(`Persistent attestor identity is ${this.servicePublicKey}, expected ${expectedPublicKey}`);
    }
    for (let index = 0; index < this.core.length; index += 1) {
      const block = await this.core.get(index, { wait: false });
      if (!block) throw new Error(`Answer receipt log is missing local block ${index}`);
      const record = decodeAnswerAcceptedReceiptRecord(block);
      const token = verifyAcceptanceToken(record.token, this.servicePublicKey, this.receiptFeedKey);
      if (token.claims.receiptIndex !== index) throw new Error(`Answer receipt ${index} has the wrong durable index`);
      verifyMemberSubmission(token.claims.submission);
      this.remember(token.claims.submission, true);
    }
  }

  assertFresh(submission: SignedAnswerSubmission): void {
    if (this.requestIds.has(submission.requestId)) {
      throw new AttestorError("REQUEST_REPLAYED", "Answer request ID has already been accepted");
    }
    if (this.answerIds.has(submission.answerId)) {
      throw new AttestorError("ANSWER_REPLAYED", "Answer ID has already been accepted");
    }
    if (this.memberCalls.has(memberCallKey(submission))) {
      throw new AttestorError("ANSWER_ALREADY_ATTESTED", "This member already has an immutable answer for the call");
    }
  }

  async append(submission: SignedAnswerSubmission, facts: AcceptanceFacts): Promise<AnswerAcceptanceToken> {
    this.assertFresh(submission);
    const receiptIndex = this.core.length;
    const claims: AnswerAcceptanceClaims = {
      version: ANSWER_ATTESTATION_VERSION,
      tokenId: `aat:${this.servicePublicKey}:${receiptIndex}`,
      receiptIndex,
      servicePublicKey: this.servicePublicKey,
      receiptFeedKey: this.receiptFeedKey,
      serviceReceivedAt: facts.serviceReceivedAt,
      deadlineAt: facts.deadlineAt,
      fixtureFeedKey: facts.fixtureFeedKey,
      fixtureFeedFork: facts.fixtureFeedFork,
      fixtureFeedLength: facts.fixtureFeedLength,
      fixtureFeedTreeHash: facts.fixtureFeedTreeHash,
      callFeedIndex: facts.callFeedIndex,
      fixtureId: facts.fixtureId,
      locksAt: facts.locksAt,
      submission,
    };
    const secretKey = this.core.keyPair?.secretKey;
    if (!secretKey) throw new Error("Answer receipt log lost its signing key");
    const token: AnswerAcceptanceToken = {
      claims,
      signature: b4a.toString(hypercoreCrypto.sign(answerAcceptanceSigningBytes(claims), secretKey), "hex"),
    };
    await this.core.append(encodeAnswerAcceptedReceiptRecord({
      version: ANSWER_ATTESTATION_VERSION,
      kind: "answer.accepted",
      token,
    }));
    if (this.core.length !== receiptIndex + 1) throw new Error("Answer receipt append did not commit exactly one block");
    this.remember(submission, false);
    return token;
  }

  private remember(submission: SignedAnswerSubmission, loading: boolean): void {
    const key = memberCallKey(submission);
    if (loading && (
      this.requestIds.has(submission.requestId)
      || this.answerIds.has(submission.answerId)
      || this.memberCalls.has(key)
    )) {
      throw new Error("Answer receipt log contains duplicate immutable answer keys");
    }
    this.requestIds.add(submission.requestId);
    this.answerIds.add(submission.answerId);
    this.memberCalls.add(key);
  }
}

function memberCallKey(submission: SignedAnswerSubmission): string {
  const publicKey = b4a.from(submission.identityPublicKey, "hex");
  // Deriving again here keeps the persistence index tied to the cryptographic
  // identity even if a malformed caller object bypassed TypeScript.
  return `${userIdFromIdentityPublicKey(publicKey)}\0${submission.callId}`;
}
