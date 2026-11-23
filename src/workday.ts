// Thin Workday REST client. Every call runs as the logged-in user, so Workday applies that user's
// own security: a user without rights to a field simply does not get it (HTTP 200, field missing).
import type { Config } from './config.js';
import { WorkdayAuth } from './auth.js';

export class WorkdayError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export class WorkdayClient {
  constructor(private cfg: Config, private auth: WorkdayAuth) {}

  async get(path: string, query: Record<string, string | number | undefined> = {}): Promise<unknown> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const url = `${this.cfg.restUrl}${path}${qs.size ? `?${qs}` : ''}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.auth.accessToken();
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (r.status === 401 && attempt === 0 && (await this.auth.refresh())) continue;
      if (r.status === 401) await this.auth.refresh(); // clears tokens so the next call asks for login
      const text = await r.text();
      if (!r.ok) {
        let msg = text.slice(0, 300);
        try { const j = JSON.parse(text); msg = j.error ?? msg; } catch { /* not JSON */ }
        throw new WorkdayError(r.status, `Workday returned HTTP ${r.status}: ${msg}`);
      }
      return JSON.parse(text);
    }
    throw new WorkdayError(401, 'Workday session expired. Run the tool again to log in.');
  }
}
