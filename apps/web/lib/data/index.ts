/**
 * The data seam — the only surface components import for data. Swappable mock/live
 * implementations sit behind it; no transport (Supabase etc.) leaks past this line.
 */

export * from "./types";
export * from "./hooks";
export { DataProvider, useData } from "./provider";
export type { ForcedState } from "./provider";
export { DATA_MODE } from "./client";
export { FM_FIXTURE_ID, FM_ROOM_ID, FM_INVITE_CODE } from "./mock/corpus";
export { SCENARIO_LABELS } from "./mock/scenario";
export type { ScenarioLabel } from "./mock/scenario";
