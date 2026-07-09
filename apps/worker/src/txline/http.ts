/**
 * Thin HTTP layer over the TxLINE API. Attaches auth headers, retries once on 401
 * after refreshing credentials, and exposes a raw streaming response for SSE.
 */

import type { TxlineAuth } from "./auth.js";

export type Query = Record<string, string | number | undefined>;

export class TxlineHttp {
  constructor(
    private readonly origin: string,
    private readonly auth: TxlineAuth,
  ) {}

  private url(path: string, query?: Query): string {
    const url = new URL(path, this.origin);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.auth.accessJwt) headers.Authorization = `Bearer ${this.auth.accessJwt}`;
    if (this.auth.accessApiToken) headers["X-Api-Token"] = this.auth.accessApiToken;
    return headers;
  }

  /** GET JSON with a single transparent refresh+retry on 401. */
  async getJson<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
    const doFetch = () =>
      fetch(this.url(path, query), {
        headers: this.authHeaders({ Accept: "application/json" }),
        signal,
      });

    let res = await doFetch();
    if (res.status === 401) {
      await this.auth.refresh();
      res = await doFetch();
    }
    if (!res.ok) {
      throw new Error(`GET ${path} failed: ${res.status} ${await safeText(res)}`);
    }
    return (await res.json()) as T;
  }

  /**
   * Open an SSE response. Returns the streaming `Response`; the caller reads
   * `res.body`. Refreshes once on 401 before giving up.
   */
  async openStream(
    path: string,
    query?: Query,
    lastEventId?: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers = (): Record<string, string> =>
      this.authHeaders({
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
      });

    let res = await fetch(this.url(path, query), { headers: headers(), signal });
    if (res.status === 401) {
      await this.auth.refresh();
      res = await fetch(this.url(path, query), { headers: headers(), signal });
    }
    if (!res.ok || !res.body) {
      throw new Error(`stream ${path} failed: ${res.status} ${await safeText(res)}`);
    }
    return res;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<no body>";
  }
}
