import { LiveDataClient } from "./live/index";
import { MockDataClient } from "./mock/index";
import type { FullTimeData } from "./types";

/** Default is mock. Set NEXT_PUBLIC_DATA_MODE=live once the backend seam is wired. */
export const DATA_MODE: "mock" | "live" =
  process.env.NEXT_PUBLIC_DATA_MODE === "live" ? "live" : "mock";

let browserClient: FullTimeData | null = null;

/** One client instance in the browser (so mock scenario/session persist across routes). */
export function getDataClient(): FullTimeData {
  const make = (): FullTimeData => (DATA_MODE === "live" ? new LiveDataClient() : new MockDataClient());
  if (typeof window === "undefined") return make();
  if (!browserClient) browserClient = make();
  return browserClient;
}
