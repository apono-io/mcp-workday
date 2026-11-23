// Workday login: OAuth authorization code (+ optional PKCE), refresh on 401.
// Tokens are kept in memory only (open question Q5): a new server process means a new login.
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import type { Config } from './config.js';

interface Tokens { access: string; refresh?: string }

export class LoginRequired extends Error {
  constructor(public loginUrl: string) {
    super(`Not logged in to Workday. Open this link in your browser and log in, then run the tool again:\n${loginUrl}`);
  }
}

export class WorkdayAuth {
  private tokens?: Tokens;
  private pending?: { url: string; done: Promise<void> };

  constructor(private cfg: Config) {}

  /** Returns a valid access token, or throws LoginRequired with a link to open. */
  async accessToken(): Promise<string> {
    if (this.tokens) return this.tokens.access;
    throw new LoginRequired(await this.startLogin());
  }

  /** Called after a 401. Returns true when a refresh gave a new access token. */
  async refresh(): Promise<boolean> {
    const rt = this.tokens?.refresh;
    this.tokens = undefined;
    if (!rt) return false;
    try {
      this.tokens = await this.tokenCall({ grant_type: 'refresh_token', refresh_token: rt });
      return true;
    } catch { return false; }
  }

  /** Starts the login listener and returns the link only once the listener is up, so a busy port or a missing certificate is reported to the user, not just logged. */
  private async startLogin(): Promise<string> {
    if (this.pending) return this.pending.url;
    const state = crypto.randomBytes(16).toString('hex');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const params: Record<string, string> = {
      response_type: 'code', client_id: this.cfg.clientId, redirect_uri: this.cfg.redirectUri, state,
    };
    if (this.cfg.usePkce) {
      params.code_challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      params.code_challenge_method = 'S256';
    }
    const url = `${this.cfg.authorizeUrl}?${new URLSearchParams(params)}`;
    let onListening!: () => void;
    const listening = new Promise<void>((resolve) => { onListening = resolve; });
    const done = this.waitForCallback(state, verifier, onListening).finally(() => { this.pending = undefined; });
    done.catch((e) => console.error(`[mcp-workday] login failed: ${e.message}`));
    this.pending = { url, done };
    await Promise.race([listening, done]);
    return url;
  }

  private waitForCallback(state: string, verifier: string, onListening: () => void): Promise<void> {
    const path = new URL(this.cfg.redirectUri).pathname;
    return new Promise((resolve, reject) => {
      const handler: http.RequestListener = async (req, res) => {
        const u = new URL(req.url ?? '/', 'http://localhost');
        if (u.pathname !== path) { res.writeHead(404).end(); return; }
        const reply = (ok: boolean, msg: string) =>
          res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' })
            .end(`<html><body><p>${msg}</p></body></html>`);
        const finish = (ok: boolean, msg: string) => {
          reply(ok, msg); clearTimeout(timer); server.close(); server.closeAllConnections();
        };
        const code = u.searchParams.get('code');
        // A stray or forged callback (wrong state) is refused but does not end the login.
        if (u.searchParams.get('state') !== state) { reply(false, 'Unknown login attempt. Use the latest login link.'); return; }
        if (!code) {
          finish(false, 'Workday login failed. Run the tool again.');
          return reject(new Error(u.searchParams.get('error') ?? 'missing code'));
        }
        try {
          const p: Record<string, string> = { grant_type: 'authorization_code', code, redirect_uri: this.cfg.redirectUri };
          if (this.cfg.usePkce) p.code_verifier = verifier;
          this.tokens = await this.tokenCall(p);
          finish(true, 'Logged in to Workday. You can close this tab.');
          resolve();
        } catch (e) {
          finish(false, 'Workday login failed at the token step. Run the tool again.');
          reject(e as Error);
        }
      };
      const tls = this.cfg.tlsCertFile && this.cfg.tlsKeyFile;
      if (!tls && /^https:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(this.cfg.redirectUri)) {
        reject(new Error('The redirect address is https but no login certificate was found. Create cert.pem and key.pem in ~/.apono/mcp-workday/ (see the README), then run the tool again.'));
        return;
      }
      const server = tls
        ? https.createServer({ cert: fs.readFileSync(this.cfg.tlsCertFile!), key: fs.readFileSync(this.cfg.tlsKeyFile!) }, handler)
        : http.createServer(handler);
      server.on('error', (e: NodeJS.ErrnoException) => reject(new Error(e.code === 'EADDRINUSE' ? `Port ${this.cfg.listenPort} is already in use. Stop the program that uses it, then run the tool again.` : e.message)));
      server.listen(this.cfg.listenPort, '127.0.0.1', onListening);
      const timer = setTimeout(() => { server.close(); server.closeAllConnections(); reject(new Error('login timed out')); }, this.cfg.loginTimeoutMs);
    });
  }

  private async tokenCall(params: Record<string, string>): Promise<Tokens> {
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const body = new URLSearchParams(params);
    if (this.cfg.clientSecret) {
      headers.Authorization = 'Basic ' + Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    } else {
      body.set('client_id', this.cfg.clientId);
    }
    const r = await fetch(this.cfg.tokenUrl, { method: 'POST', headers, body });
    if (!r.ok) throw new Error(`token endpoint HTTP ${r.status}`); // body not logged: may echo request data
    const j = (await r.json()) as { access_token?: string; refresh_token?: string };
    if (!j.access_token) throw new Error('token endpoint returned no access_token');
    // Workday may omit a new refresh token on refresh; keep the old one then.
    return { access: j.access_token, refresh: j.refresh_token ?? params.refresh_token };
  }
}
