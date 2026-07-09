/**
 * Identity. Sign-in is Solana under the hood but the wallet address is treated as
 * an identifier, never marketing data, and never surfaced in the main room flow —
 * fans are known by display name.
 */

import type { UserId } from "./ids.js";
import type { WallClock } from "./time.js";

export interface User {
  id: UserId;
  displayName: string;
  /** Solana address — identifier only; kept out of the fan-facing UI. */
  walletAddress?: string;
  createdAt: WallClock;
}
