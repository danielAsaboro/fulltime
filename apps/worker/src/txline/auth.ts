/**
 * TxLINE auth token store and the two HTTP auth calls.
 *
 * Chain: guest JWT (`/auth/guest/start`) → on-chain `subscribe` (see activation.ts)
 * → wallet-signed activation (`/api/token/activate`) → long-lived API token. Every
 * data request then carries `Authorization: Bearer <jwt>` + `X-Api-Token`.
 *
 * Fast path for the demo: if a JWT and API token are already available (obtained via
 * the affiliate site or a prior activation), seed them and skip on-chain work.
 * The store caches the activation payload so a 401 can transparently re-acquire both.
 */

import type { Logger } from "../logger.js";
import type { ActivationPayload, TokenResponse } from "./types.js";

export interface AuthSeed {
  jwt?: string;
  apiToken?: string;
}

export class TxlineAuth {
  private jwt: string | null;
  private apiToken: string | null;
  private cachedActivation: ActivationPayload | null = null;

  constructor(
    private readonly origin: string,
    private readonly log: Logger,
    seed: AuthSeed = {},
  ) {
    this.jwt = seed.jwt ?? null;
    this.apiToken = seed.apiToken ?? null;
  }

  get accessJwt(): string | null {
    return this.jwt;
  }

  get accessApiToken(): string | null {
    return this.apiToken;
  }

  hasStreamingCredentials(): boolean {
    return Boolean(this.jwt && this.apiToken);
  }

  /** POST /auth/guest/start → JWT (valid 30 days). */
  async startGuest(): Promise<string> {
    const res = await fetch(`${this.origin}/auth/guest/start`, { method: "POST" });
    if (!res.ok) {
      throw new Error(`guest/start failed: ${res.status} ${await safeText(res)}`);
    }
    const body = (await res.json()) as TokenResponse;
    if (!body?.token) throw new Error("guest/start returned no token");
    this.jwt = body.token;
    this.log.info("Acquired guest JWT");
    return body.token;
  }

  /** POST /api/token/activate (Bearer JWT) → long-lived API token (text/plain). */
  async activate(payload: ActivationPayload): Promise<string> {
    if (!this.jwt) throw new Error("activate requires a JWT; call startGuest first");
    const res = await fetch(`${this.origin}/api/token/activate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.jwt}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`token/activate failed: ${res.status} ${await safeText(res)}`);
    }
    const apiToken = (await res.text()).trim();
    if (!apiToken) throw new Error("token/activate returned an empty API token");
    this.apiToken = apiToken;
    this.cachedActivation = payload;
    this.log.info("Activated subscription; API token issued");
    return apiToken;
  }

  seed(seed: AuthSeed): void {
    if (seed.jwt) this.jwt = seed.jwt;
    if (seed.apiToken) this.apiToken = seed.apiToken;
  }

  /**
   * Re-acquire credentials after a 401. Re-runs guest start; if we hold the
   * activation payload, re-activates to mint a fresh API token bound to the new JWT.
   */
  async refresh(): Promise<void> {
    this.log.warn("Refreshing TxLINE credentials after 401");
    await this.startGuest();
    if (this.cachedActivation) {
      await this.activate(this.cachedActivation);
    } else {
      this.log.warn("No cached activation to replay — API token may still be stale");
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<no body>";
  }
}
