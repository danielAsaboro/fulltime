/**
 * @fulltime/shared — the framework-free domain model and pure logic shared by the
 * worker and the web app. Feed time is authoritative; MatchSync is presentation
 * only; settlement is pure, total, and idempotent. Keeping this the single source
 * of truth is what stops worker and client logic from drifting apart.
 */

export * from "./ids";
export * from "./time";
export * from "./identity";
export * from "./fixtures";
export * from "./feed";
export * from "./events";
export * from "./odds";
export * from "./rooms";
export * from "./matchsync";
export * from "./calls";
export * from "./answers";
export * from "./settlements";
export * from "./receipts";
export * from "./scoring";
export * from "./social";
export * from "./market-says";
export * from "./records";
export * from "./highlights";
export * from "./realtime";
