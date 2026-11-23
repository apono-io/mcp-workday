// All settings come from environment variables, set by the Apono gateway (or by hand for local tests).
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Default place for the login certificate: ~/.apono/mcp-workday/cert.pem and key.pem (see the README).
function defaultTlsFile(name: string): string | undefined {
  const file = join(homedir(), '.apono', 'mcp-workday', name);
  return existsSync(file) ? file : undefined;
}

export interface Config {
  authorizeUrl: string;   // https://<host>.wdNNN.myworkday.com/<tenant>/authorize
  tokenUrl: string;       // https://<host>-services1.wdNNN.myworkday.com/ccx/oauth2/<tenant>/token
  restUrl: string;        // https://<host>-services1.wdNNN.myworkday.com/ccx/api/v1/<tenant>
  clientId: string;
  clientSecret?: string;  // optional: sent as HTTP Basic when present (open question Q1/Q2)
  usePkce: boolean;       // send a PKCE challenge (open question Q2)
  redirectUri: string;    // must match the API client registered in Workday
  listenPort: number;     // local port the login callback listener uses
  tlsCertFile?: string;   // only for an https redirect URI served directly (Q3 option A)
  tlsKeyFile?: string;
  loginTimeoutMs: number;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v.replace(/\/+$/, '');
}

export function loadConfig(): Config {
  const redirectUri = process.env.WORKDAY_REDIRECT_URI ?? 'http://localhost:8976/oauth/callback';
  const u = new URL(redirectUri);
  // A redirect that is not on this machine is a bounce page: it forwards the browser to http://localhost:8976 + the same path.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  return {
    authorizeUrl: req('WORKDAY_AUTHORIZE_URL'),
    tokenUrl: req('WORKDAY_TOKEN_URL'),
    restUrl: req('WORKDAY_REST_URL'),
    clientId: req('WORKDAY_CLIENT_ID'),
    clientSecret: process.env.WORKDAY_CLIENT_SECRET || undefined,
    usePkce: (process.env.WORKDAY_USE_PKCE ?? 'true') !== 'false',
    redirectUri,
    listenPort: Number(process.env.WORKDAY_LISTEN_PORT ?? (local ? (u.port || (u.protocol === 'https:' ? 443 : 80)) : 8976)),
    tlsCertFile: local && u.protocol === 'https:' ? (process.env.WORKDAY_TLS_CERT_FILE || defaultTlsFile('cert.pem')) : undefined,
    tlsKeyFile: local && u.protocol === 'https:' ? (process.env.WORKDAY_TLS_KEY_FILE || defaultTlsFile('key.pem')) : undefined,
    loginTimeoutMs: Number(process.env.WORKDAY_LOGIN_TIMEOUT_MS ?? 300000),
  };
}
