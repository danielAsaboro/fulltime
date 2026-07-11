import { LiveDataClient } from "./live/index";
import type { FullTimeData } from "./types";

let browserClient: FullTimeData | null = null;

/** One Pear-backed client instance in the browser so subscriptions persist across routes. */
export function getDataClient(): FullTimeData {
  if (typeof window === "undefined") return new LiveDataClient();
  if (!browserClient) browserClient = new LiveDataClient();
  return browserClient;
}
