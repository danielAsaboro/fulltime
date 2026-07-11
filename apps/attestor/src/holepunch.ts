import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface HypercoreLike {
  readonly key: Uint8Array;
  readonly discoveryKey: Uint8Array;
  readonly keyPair: KeyPair | null;
  readonly length: number;
  readonly contiguousLength: number;
  readonly fork: number;
  ready(): Promise<void>;
  append(block: Uint8Array): Promise<unknown>;
  get(index: number, options?: { wait?: boolean; timeout?: number }): Promise<Uint8Array | null>;
  update(options?: { wait?: boolean }): Promise<boolean>;
  treeHash(length?: number): Promise<Uint8Array>;
}

export interface CorestoreLike {
  ready(): Promise<void>;
  get(options: { name: string; active?: boolean } | { key: Uint8Array; active?: boolean }): HypercoreLike;
  replicate(connection: unknown): unknown;
  close(): Promise<void>;
}

interface CorestoreConstructor {
  new (storage: string): CorestoreLike;
}

export interface DiscoveryLike {
  flushed(): Promise<void>;
  destroy(): Promise<void>;
}

export interface PeerInfoLike {
  client?: boolean;
  topics?: Uint8Array[];
}

export interface ConnectionLike {
  destroyed?: boolean;
  once(event: "close" | "error", listener: (error?: Error) => void): this;
  destroy(error?: Error): void;
}

export interface HyperswarmLike {
  readonly connections: Set<ConnectionLike>;
  on(event: "connection", listener: (connection: ConnectionLike, peerInfo: PeerInfoLike) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  join(topic: Uint8Array, options: { server: boolean; client: boolean }): DiscoveryLike;
  destroy(): Promise<void>;
}

interface HyperswarmConstructor {
  new (options?: { bootstrap?: BootstrapNode[]; maxPeers?: number }): HyperswarmLike;
}

export interface BootstrapNode {
  host: string;
  port: number;
}

export interface ProtomuxMessageLike {
  send(value: Uint8Array): boolean;
}

export interface ProtomuxChannelLike {
  readonly opened: boolean;
  readonly closed: boolean;
  addMessage(options: {
    encoding: unknown;
    onmessage?: (value: Uint8Array) => void;
  }): ProtomuxMessageLike;
  open(): void;
  close(): void;
}

export interface ProtomuxLike {
  pair(descriptor: { protocol: string; id: Uint8Array }, listener: () => void): void;
  unpair(descriptor: { protocol: string; id: Uint8Array }): void;
  createChannel(options: {
    protocol: string;
    id: Uint8Array;
    unique?: boolean;
    onopen?: () => void;
    onclose?: () => void;
  }): ProtomuxChannelLike | null;
}

interface ProtomuxStatic {
  from(connection: ConnectionLike): ProtomuxLike;
}

interface HypercoreCrypto {
  keyPair(seed?: Uint8Array): KeyPair;
  randomBytes(length: number): Uint8Array;
  sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array;
  verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
}

interface B4a {
  from(value: string | Uint8Array, encoding?: "hex" | "utf8"): Uint8Array;
  toString(value: Uint8Array, encoding?: "hex" | "utf8"): string;
  equals(left: Uint8Array, right: Uint8Array): boolean;
}

interface Z32 {
  encode(value: Uint8Array): string;
}

export const Corestore = require("corestore") as CorestoreConstructor;
export const Hyperswarm = require("hyperswarm") as HyperswarmConstructor;
export const Protomux = require("protomux") as ProtomuxStatic;
export const compactEncoding = require("compact-encoding") as { buffer: unknown };
export const hypercoreCrypto = require("hypercore-crypto") as HypercoreCrypto;
export const b4a = require("b4a") as B4a;
export const z32 = require("z32") as Z32;
