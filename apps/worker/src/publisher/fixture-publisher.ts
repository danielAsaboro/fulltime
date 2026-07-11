/**
 * Persistent single-writer publisher for FullTime's public fixture plane.
 *
 * The Hypercore key is the publisher identity. Consumers must pin that exact key;
 * discovering a core by a key supplied by a room or renderer would let a room
 * creator impersonate TxLINE facts. Hypercore verifies every replicated block's
 * signature before exposing it.
 */

import { createRequire } from "node:module";
import path from "node:path";

import {
  FIXTURE_PLANE_VERSION,
  decodeFixturePlaneRecord,
  encodeFixturePlaneRecord,
  parseFixturePlaneRecord,
  type FixtureCallOpenRecord,
  type FixtureCallSettledRecord,
  type Fixture,
  type FixturePlaneRecord,
  type FixtureScoreRecord,
  type FixtureState,
  type MatchEvent,
  type OddsSnapshot,
  type PublishedScoreUpdate,
} from "@fulltime/shared";

import type { Logger } from "../logger.js";
import { SignedFixturePlaneState } from "../state/fixture-plane-state.js";

const require = createRequire(import.meta.url);
const Corestore = require("corestore") as CorestoreConstructor;
const Hyperswarm = require("hyperswarm") as HyperswarmConstructor;

const CORE_NAME = "fulltime-public-fixture-plane-v1";

interface HypercoreLike {
  key: Uint8Array;
  discoveryKey: Uint8Array;
  length: number;
  ready(): Promise<void>;
  append(block: Uint8Array): Promise<unknown>;
  get(index: number): Promise<Uint8Array | null>;
}

interface CorestoreLike {
  ready(): Promise<void>;
  get(options: { name: string }): HypercoreLike;
  replicate(connection: unknown): unknown;
  close(): Promise<void>;
}

interface CorestoreConstructor {
  new (storage: string): CorestoreLike;
}

interface DiscoveryLike {
  flushed(): Promise<void>;
  destroy(): Promise<void>;
}

interface HyperswarmLike {
  on(event: "connection", listener: (connection: unknown) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  join(discoveryKey: Uint8Array, options: { server: boolean; client: boolean }): DiscoveryLike;
  destroy(): Promise<void>;
}

interface HyperswarmConstructor {
  new (options?: { bootstrap?: Array<{ host: string; port: number }> }): HyperswarmLike;
}

export interface FixturePlanePublisherOptions {
  storageDir: string;
  log: Logger;
  /** Tests and offline tooling can exercise the signed log without opening DHT sockets. */
  networking?: boolean;
  bootstrap?: Array<{ host: string; port: number }>;
}

export interface FixturePlaneDescriptor {
  protocol: "fulltime-fixture-plane";
  version: typeof FIXTURE_PLANE_VERSION;
  key: string;
  discoveryKey: string;
  storageDir: string;
}

export interface PublishResult {
  appended: boolean;
  index: number;
}

interface IndexedRecord {
  fingerprint: string;
  index: number;
}

export class FixturePlanePublisher {
  private readonly storageDir: string;
  private readonly log: Logger;
  private readonly networking: boolean;
  private readonly bootstrap: Array<{ host: string; port: number }> | undefined;
  private store: CorestoreLike | null = null;
  private core: HypercoreLike | null = null;
  private swarm: HyperswarmLike | null = null;
  private discovery: DiscoveryLike | null = null;
  private appendTail: Promise<void> = Promise.resolve();
  private readonly index = new Map<string, IndexedRecord>();
  private readonly state = new SignedFixturePlaneState();
  private opened = false;
  private closing = false;

  constructor(options: FixturePlanePublisherOptions) {
    this.storageDir = path.resolve(options.storageDir);
    this.log = options.log;
    this.networking = options.networking ?? true;
    this.bootstrap = options.bootstrap;
  }

  async open(): Promise<FixturePlaneDescriptor> {
    if (this.opened) return this.descriptor;
    if (this.closing) throw new Error("Fixture publisher is closing");

    const store = new Corestore(this.storageDir);
    this.store = store;

    try {
      await store.ready();
      const core = store.get({ name: CORE_NAME });
      this.core = core;
      await core.ready();
      await this.loadIndex();
      await this.reconcileDerivedRecords();
      if (this.networking) {
        const swarm = new Hyperswarm(this.bootstrap ? { bootstrap: this.bootstrap } : undefined);
        this.swarm = swarm;
        swarm.on("connection", (connection) => store.replicate(connection));
        swarm.on("error", (error) => {
          this.log.warn("Fixture-plane Hyperswarm error", { error: error.message });
        });
        const discovery = swarm.join(core.discoveryKey, { server: true, client: true });
        this.discovery = discovery;
        await discovery.flushed();
      }
      this.opened = true;
      return this.descriptor;
    } catch (error) {
      await this.discovery?.destroy().catch(() => undefined);
      await this.swarm?.destroy().catch(() => undefined);
      await store.close().catch(() => undefined);
      this.store = null;
      this.core = null;
      this.swarm = null;
      this.discovery = null;
      this.index.clear();
      this.state.clear();
      throw error;
    }
  }

  get descriptor(): FixturePlaneDescriptor {
    const core = this.requireCore();
    return {
      protocol: "fulltime-fixture-plane",
      version: FIXTURE_PLANE_VERSION,
      key: Buffer.from(core.key).toString("hex"),
      discoveryKey: Buffer.from(core.discoveryKey).toString("hex"),
      storageDir: this.storageDir,
    };
  }

  get length(): number {
    return this.requireCore().length;
  }

  /** Latest signed fold per fixture, used to resume sequence/status state after restart. */
  scoreCheckpoints(): FixtureScoreRecord[] {
    this.requireCore();
    return this.state.scoreCheckpoints();
  }

  /** Canonical signed event history rebuilt from the public log. */
  eventCheckpoints(fixtureId: string): MatchEvent[] {
    this.requireCore();
    return this.state.eventHistory(fixtureId);
  }

  /** Signed odds history rebuilt from the public log. */
  oddsCheckpoints(fixtureId: string): OddsSnapshot[] {
    this.requireCore();
    return this.state.oddsHistory(fixtureId);
  }

  /** Calls still undecided at the current signed feed frontier. */
  openCallCheckpoints(): FixtureCallOpenRecord[] {
    this.requireCore();
    return this.state.openCallRecords();
  }

  settlementCheckpoints(): FixtureCallSettledRecord[] {
    this.requireCore();
    return this.state.settlementRecords();
  }

  publishFixture(fixture: Fixture, publishedAt = Date.now()): Promise<PublishResult> {
    return this.publish({
      version: FIXTURE_PLANE_VERSION,
      kind: "fixture.upsert",
      publishedAt: publishedAt as FixturePlaneRecord["publishedAt"],
      fixture,
    });
  }

  publishScore(
    update: PublishedScoreUpdate,
    state: FixtureState,
    events: MatchEvent[],
    publishedAt = Date.now(),
  ): Promise<PublishResult> {
    return this.publish({
      version: FIXTURE_PLANE_VERSION,
      kind: "fixture.score",
      publishedAt: publishedAt as FixtureScoreRecord["publishedAt"],
      update,
      state,
      events,
    });
  }

  publishOdds(odds: OddsSnapshot, publishedAt = Date.now()): Promise<PublishResult> {
    return this.publish({
      version: FIXTURE_PLANE_VERSION,
      kind: "fixture.odds",
      publishedAt: publishedAt as FixturePlaneRecord["publishedAt"],
      odds,
    });
  }

  publish(value: FixturePlaneRecord): Promise<PublishResult> {
    if (!this.opened || this.closing) return Promise.reject(new Error("Fixture publisher is not writable"));
    const parsed = parseFixturePlaneRecord(value);
    const task = this.appendTail.then(() => this.appendWithDerivedRecords(parsed));
    this.appendTail = task.then(() => undefined, () => undefined);
    return task;
  }

  async get(index: number): Promise<FixturePlaneRecord | null> {
    const core = this.requireCore();
    if (!Number.isSafeInteger(index) || index < 0 || index >= core.length) return null;
    const block = await core.get(index);
    return block ? decodeFixturePlaneRecord(block) : null;
  }

  /** Wait until every append accepted so far is durably ordered in the core. */
  async flush(): Promise<void> {
    await this.appendTail;
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    await this.appendTail;
    await this.discovery?.destroy().catch(() => undefined);
    await this.swarm?.destroy().catch(() => undefined);
    await this.store?.close().catch(() => undefined);
    this.discovery = null;
    this.swarm = null;
    this.core = null;
    this.store = null;
    this.opened = false;
    this.index.clear();
    this.state.clear();
  }

  private async loadIndex(): Promise<void> {
    const core = this.requireCore();
    for (let index = 0; index < core.length; index += 1) {
      const block = await core.get(index);
      if (!block) throw new Error(`Fixture-plane block ${index} is unavailable in the publisher store`);
      const value = decodeFixturePlaneRecord(block);
      this.remember(value, index, true);
    }
  }

  private async appendRecord(value: FixturePlaneRecord): Promise<PublishResult> {
    const core = this.requireCore();
    const identity = recordIdentity(value);
    const existing = this.index.get(identity.key);
    if (existing && existing.fingerprint === identity.fingerprint) {
      return { appended: false, index: existing.index };
    }
    if (existing && identity.immutable) {
      throw new Error(`Conflicting fixture-plane record for ${identity.key}`);
    }

    this.state.assertCanApply(value);
    const bytes = encodeFixturePlaneRecord(value);
    await core.append(bytes);
    const index = core.length - 1;
    this.remember(value, index, false);
    return { appended: true, index };
  }

  private remember(value: FixturePlaneRecord, index: number, loading: boolean): void {
    const identity = recordIdentity(value);
    const existing = this.index.get(identity.key);
    if (existing && existing.fingerprint !== identity.fingerprint && identity.immutable) {
      throw new Error(`Signed fixture plane contains conflicting records for ${identity.key}`);
    }
    if (existing?.fingerprint === identity.fingerprint) {
      if (loading) {
        this.log.debug("Fixture-plane log contains a duplicate record", { key: identity.key, index });
      }
      return;
    }
    if (!existing || !identity.immutable || existing.fingerprint === identity.fingerprint) {
      this.index.set(identity.key, { fingerprint: identity.fingerprint, index });
    }
    this.state.apply(value);
  }

  private async appendWithDerivedRecords(value: FixturePlaneRecord): Promise<PublishResult> {
    const result = await this.appendRecord(value);
    if (value.kind === "fixture.score") {
      await this.appendMissingCalls(value.update.fixtureId);
      await this.appendSettlements(value.update.fixtureId);
    } else if (value.kind === "fixture.odds") {
      await this.appendSettlements(value.odds.fixtureId);
    } else if (value.kind === "call.open") {
      await this.appendSettlements(value.call.fixtureId);
    }
    return result;
  }

  /** Repair a crash between a signed fact and its deterministic derived records. */
  private async reconcileDerivedRecords(): Promise<void> {
    await this.appendMissingCalls();
    await this.appendSettlements();
  }

  private async appendMissingCalls(fixtureId?: string): Promise<void> {
    for (const record of this.state.missingCallRecords()) {
      if (fixtureId !== undefined && record.call.fixtureId !== fixtureId) continue;
      await this.appendRecord(record);
    }
  }

  private async appendSettlements(fixtureId?: string): Promise<void> {
    for (const record of this.state.pendingSettlementRecords(fixtureId)) {
      await this.appendRecord(record);
    }
  }

  private requireCore(): HypercoreLike {
    if (!this.core) throw new Error("Fixture publisher is not open");
    return this.core;
  }
}

function recordIdentity(value: FixturePlaneRecord): {
  key: string;
  fingerprint: string;
  immutable: boolean;
} {
  if (value.kind === "fixture.upsert") {
    return {
      key: `fixture/${value.fixture.id}`,
      fingerprint: JSON.stringify(value.fixture),
      immutable: false,
    };
  }
  if (value.kind === "fixture.score") {
    return {
      key: `score/${value.update.fixtureId}/${value.update.seq}`,
      fingerprint: JSON.stringify({ update: value.update, state: value.state, events: value.events }),
      immutable: true,
    };
  }
  if (value.kind === "fixture.odds") {
    return {
      key: `odds/${value.odds.fixtureId}/${value.odds.messageId}`,
      fingerprint: JSON.stringify(value.odds),
      immutable: true,
    };
  }
  if (value.kind === "call.open") {
    return {
      key: `call/${value.call.id}`,
      fingerprint: JSON.stringify(value.call),
      immutable: true,
    };
  }
  return {
    key: `settlement/${value.settlement.callId}`,
    fingerprint: JSON.stringify({ fixtureId: value.fixtureId, settlement: value.settlement }),
    immutable: true,
  };
}
