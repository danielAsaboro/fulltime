import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FIXTURE_PLANE_VERSION,
  encodeFixturePlaneRecord,
  type FixtureCallOpenRecord,
} from "../../../packages/shared/src/fixture-plane.js";

import { AnswerAttestorClient, AttestationRejectedError } from "../src/client.js";
import {
  Corestore,
  Hyperswarm,
  b4a,
  hypercoreCrypto,
  type BootstrapNode,
  type CorestoreLike,
  type DiscoveryLike,
  type HypercoreLike,
  type HyperswarmLike,
  type KeyPair,
} from "../src/holepunch.js";
import { signAnswerSubmission, userIdFromIdentityPublicKey, verifyAcceptanceToken } from "../src/identity.js";
import { AnswerAttestorService } from "../src/service.js";

const require = createRequire(import.meta.url);
const createTestnet = require("hyperdht/testnet") as (
  size: number,
  options: { host: string },
) => Promise<{ bootstrap: BootstrapNode[]; destroy(): Promise<void> }>;
const integrationEnabled = process.env.FULLTIME_RUN_ATTESTOR_INTEGRATION === "1";

test("attestor accepts signed answers over Protomux and durably rejects replay/conflict/late answers", {
  skip: integrationEnabled ? false : "set FULLTIME_RUN_ATTESTOR_INTEGRATION=1 to bind a local HyperDHT testnet",
  timeout: 90_000,
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fulltime-answer-attestor-"));
  let testnet: Awaited<ReturnType<typeof createTestnet>> | null = null;
  let publisher: CallPublisher | null = null;
  let service: AnswerAttestorService | null = null;
  let client: AnswerAttestorClient | null = null;
  let restarted: AnswerAttestorService | null = null;
  let restartedClient: AnswerAttestorClient | null = null;

  try {
    testnet = await createTestnet(3, { host: "127.0.0.1" });
    publisher = new CallPublisher(path.join(root, "publisher"), testnet.bootstrap);
    await publisher.open();
    const now = Date.now();
    const openCall = callRecord("call:attestor:open", now + 20_000, now);
    await publisher.publish(openCall);

    service = await new AnswerAttestorService({
      storageDir: path.join(root, "service"),
      fixtureFeedKey: publisher.key,
      bootstrap: testnet.bootstrap,
    }).open();
    const servicePublicKey = service.descriptor.servicePublicKey;
    const receiptFeedKey = service.descriptor.receiptFeedKey;
    client = await new AnswerAttestorClient({
      storageDir: path.join(root, "client"),
      servicePublicKey,
      receiptFeedKey,
      fixtureFeedKey: publisher.key,
      bootstrap: testnet.bootstrap,
    }).open();

    const member = hypercoreCrypto.keyPair();
    const request = signedRequest(member, {
      requestId: "request:accept:0001",
      answerId: "answer:accept:0001",
      callId: openCall.call.id,
      optionId: "home",
      submittedAt: now,
    });
    const token = await submitWhenFeedArrives(client, request);
    assert.equal(token.claims.receiptIndex, 0);
    assert.equal(token.claims.serviceReceivedAt <= token.claims.deadlineAt, true);
    assert.equal(token.claims.deadlineAt, openCall.call.locksAt);
    assert.equal(token.claims.fixtureFeedKey, publisher.key);
    assert.equal(token.claims.fixtureFeedLength, publisher.core.length);
    assert.equal(token.claims.callFeedIndex, 0);
    assert.equal(token.claims.fixtureFeedTreeHash, b4a.toString(await publisher.core.treeHash(), "hex"));
    assert.deepEqual(verifyAcceptanceToken(token, servicePublicKey, receiptFeedKey), token);

    // The response cannot race ahead of durability: the same signed token is
    // already block 0 of the append-only receipt Hypercore and replicates to the client.
    assert.deepEqual(await client.readReceipt(0), token);

    await rejectsCode(client.submit(request), "REQUEST_REPLAYED");
    const answerReplayMember = hypercoreCrypto.keyPair();
    await rejectsCode(client.submit(signedRequest(answerReplayMember, {
      requestId: "request:answer-replay:2",
      answerId: request.answerId,
      callId: openCall.call.id,
      optionId: "away",
      submittedAt: now + 1,
    })), "ANSWER_REPLAYED");
    await rejectsCode(client.submit(signedRequest(member, {
      requestId: "request:conflict:0002",
      answerId: "answer:conflict:0002",
      callId: openCall.call.id,
      optionId: "away",
      submittedAt: now + 1,
    })), "ANSWER_ALREADY_ATTESTED");

    const mismatchedIdentity = hypercoreCrypto.keyPair();
    await rejectsCode(client.submit(signAnswerSubmission(mismatchedIdentity, {
      version: 2,
      requestId: "request:identity-mismatch",
      answerId: "answer:identity-mismatch",
      callId: openCall.call.id,
      userId: "peer_wrong_identity",
      optionId: "home",
      submittedAt: now,
    })), "IDENTITY_MISMATCH");

    const invalidOptionMember = hypercoreCrypto.keyPair();
    await rejectsCode(client.submit(signedRequest(invalidOptionMember, {
      requestId: "request:bad-option:03",
      answerId: "answer:bad-option:03",
      callId: openCall.call.id,
      optionId: "draw",
      submittedAt: now,
    })), "INVALID_OPTION");

    const invalidSignatureMember = hypercoreCrypto.keyPair();
    const invalidSignature = signedRequest(invalidSignatureMember, {
      requestId: "request:bad-signature:04",
      answerId: "answer:bad-signature:04",
      callId: openCall.call.id,
      optionId: "home",
      submittedAt: now,
    });
    invalidSignature.signature = `${invalidSignature.signature.startsWith("00") ? "01" : "00"}${invalidSignature.signature.slice(2)}`;
    await rejectsCode(client.submit(invalidSignature), "INVALID_SIGNATURE");

    const lateCall = callRecord("call:attestor:late", now - 5_000, now - 20_000);
    await publisher.publish(lateCall);
    const lateMember = hypercoreCrypto.keyPair();
    await rejectsEventually(client, signedRequest(lateMember, {
      requestId: "request:late:000005",
      answerId: "answer:late:000005",
      callId: lateCall.call.id,
      optionId: "home",
      submittedAt: now,
    }), "ANSWER_LATE");

    // Serialized handling guarantees exactly one durable answer when two
    // different answer IDs race for the same member+call.
    const raceCall = callRecord("call:attestor:race", Date.now() + 30_000, Date.now());
    await publisher.publish(raceCall);
    const racer = hypercoreCrypto.keyPair();
    const raceRequests = ["home", "away"].map((optionId, index) => signedRequest(racer, {
      requestId: `request:race:00000${index}`,
      answerId: `answer:race:00000${index}`,
      callId: raceCall.call.id,
      optionId,
      submittedAt: Date.now(),
    }));
    await waitForCall(client, raceRequests[0]!);
    const raced = await Promise.allSettled(raceRequests.map((entry) => client!.submit(entry)));
    assert.equal(raced.filter((entry) => entry.status === "fulfilled").length, 1);
    const raceFailure = raced.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
    assert.equal(raceFailure?.reason instanceof AttestationRejectedError, true);
    assert.equal((raceFailure?.reason as AttestationRejectedError).code, "ANSWER_ALREADY_ATTESTED");

    await client.close();
    client = null;
    await service.close();
    service = null;

    restarted = await new AnswerAttestorService({
      storageDir: path.join(root, "service"),
      fixtureFeedKey: publisher.key,
      expectedServicePublicKey: servicePublicKey,
      expectedReceiptFeedKey: receiptFeedKey,
      bootstrap: testnet.bootstrap,
    }).open();
    assert.equal(restarted.descriptor.servicePublicKey, servicePublicKey);
    assert.equal(restarted.descriptor.receiptLength, 2);
    restartedClient = await new AnswerAttestorClient({
      storageDir: path.join(root, "restarted-client"),
      servicePublicKey,
      receiptFeedKey,
      fixtureFeedKey: publisher.key,
      bootstrap: testnet.bootstrap,
    }).open();
    await rejectsCode(restartedClient.submit(request), "REQUEST_REPLAYED");
    assert.deepEqual(await restartedClient.readReceipt(0), token);
  } catch (error) {
    process.stderr.write(`[attestor integration failure] ${error instanceof Error ? error.stack : String(error)}\n`);
    throw error;
  } finally {
    await restartedClient?.close().catch(() => undefined);
    await restarted?.close().catch(() => undefined);
    await client?.close().catch(() => undefined);
    await service?.close().catch(() => undefined);
    await publisher?.close().catch(() => undefined);
    await testnet?.destroy().catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true });
  }
});

class CallPublisher {
  readonly storageDir: string;
  readonly bootstrap: BootstrapNode[];
  store!: CorestoreLike;
  core!: HypercoreLike;
  swarm!: HyperswarmLike;
  discovery!: DiscoveryLike;

  constructor(storageDir: string, bootstrap: BootstrapNode[]) {
    this.storageDir = storageDir;
    this.bootstrap = bootstrap;
  }

  get key(): string {
    return b4a.toString(this.core.key, "hex");
  }

  async open(): Promise<void> {
    this.store = new Corestore(this.storageDir);
    await this.store.ready();
    this.core = this.store.get({ name: "attestor-integration-fixture-feed", active: true });
    await this.core.ready();
    this.swarm = new Hyperswarm({ bootstrap: this.bootstrap });
    this.swarm.on("connection", (connection) => { this.store.replicate(connection); });
    this.swarm.on("error", () => undefined);
    this.discovery = this.swarm.join(this.core.discoveryKey, { server: true, client: false });
    await this.discovery.flushed();
  }

  async publish(record: FixtureCallOpenRecord): Promise<void> {
    await this.core.append(encodeFixturePlaneRecord(record));
  }

  async close(): Promise<void> {
    await this.discovery?.destroy().catch(() => undefined);
    await this.swarm?.destroy().catch(() => undefined);
    await this.store?.close().catch(() => undefined);
  }
}

function callRecord(id: string, locksAt: number, openedAt: number): FixtureCallOpenRecord {
  return {
    version: FIXTURE_PLANE_VERSION,
    kind: "call.open",
    publishedAt: openedAt as FixtureCallOpenRecord["publishedAt"],
    call: {
      id: id as FixtureCallOpenRecord["call"]["id"],
      fixtureId: "fixture:attestor:1" as FixtureCallOpenRecord["call"]["fixtureId"],
      roomId: null,
      template: "next-event",
      spec: { kind: "next-event", event: "goal" },
      prompt: "Who scores the next goal?",
      options: [
        { id: "home", label: "Home" },
        { id: "away", label: "Away" },
      ],
      openedAt: openedAt as FixtureCallOpenRecord["call"]["openedAt"],
      locksAt: locksAt as FixtureCallOpenRecord["call"]["locksAt"],
      settlesBy: (locksAt + 60_000) as FixtureCallOpenRecord["call"]["settlesBy"],
      scored: true,
      status: "open",
    },
  };
}

interface RequestFields {
  requestId: string;
  answerId: string;
  callId: string;
  optionId: string;
  submittedAt: number;
}

function signedRequest(keyPair: KeyPair, fields: RequestFields) {
  return signAnswerSubmission(keyPair, {
    version: 2,
    ...fields,
    userId: userIdFromIdentityPublicKey(keyPair.publicKey),
  });
}

async function submitWhenFeedArrives(client: AnswerAttestorClient, request: ReturnType<typeof signedRequest>) {
  let last: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await client.submit(request);
    } catch (error) {
      last = error;
      if (!(error instanceof AttestationRejectedError) || !["CALL_UNKNOWN", "FEED_UNAVAILABLE"].includes(error.code)) throw error;
      await delay(100);
    }
  }
  throw last;
}

async function rejectsEventually(
  client: AnswerAttestorClient,
  request: ReturnType<typeof signedRequest>,
  expectedCode: string,
): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await client.submit(request);
      assert.fail(`Expected ${expectedCode}`);
    } catch (error) {
      last = error;
      if (error instanceof AttestationRejectedError && ["CALL_UNKNOWN", "FEED_UNAVAILABLE"].includes(error.code)) {
        await delay(100);
        continue;
      }
      assert.equal(error instanceof AttestationRejectedError, true);
      assert.equal((error as AttestationRejectedError).code, expectedCode);
      return;
    }
  }
  throw last;
}

async function waitForCall(client: AnswerAttestorClient, request: ReturnType<typeof signedRequest>): Promise<void> {
  // A rejected invalid option proves that the newly appended call is in the
  // service's verified projection without consuming an immutable answer.
  const probeKey = hypercoreCrypto.keyPair();
  const probe = signedRequest(probeKey, {
    requestId: "request:race-probe:00",
    answerId: "answer:race-probe:00",
    callId: request.callId,
    optionId: "invalid",
    submittedAt: Date.now(),
  });
  await rejectsEventually(client, probe, "INVALID_OPTION");
}

async function rejectsCode(promise: Promise<unknown>, expectedCode: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal(error instanceof AttestationRejectedError, true);
    assert.equal((error as AttestationRejectedError).code, expectedCode);
    return true;
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
