// Smoke test against a fake Workday on localhost. No network, no real secret.
// Checks: login link, callback + token swap (Basic auth, PKCE), both tools, refresh on 401, field limits pass through.
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const FAKE = 18080, CB = 18976, SECRET = 'fake-secret';
let challenge, issued = 0, expireNext = false;
const seen = { basic: false, verifierOk: false, refreshed: false };
const workers = [
  { id: 'w1', descriptor: 'Logan McNeil', businessTitle: 'VP' },
  { id: 'w2', descriptor: 'Kelly Brown', businessTitle: 'Executive Assistant' },
];

const fake = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${FAKE}`);
  let body = ''; for await (const c of req) body += c;
  const send = (s, j) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (u.pathname === '/t/token') {
    const p = new URLSearchParams(body);
    seen.basic ||= req.headers.authorization === 'Basic ' + Buffer.from(`cid:${SECRET}`).toString('base64');
    if (p.get('grant_type') === 'authorization_code') {
      seen.verifierOk = crypto.createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url') === challenge;
      if (p.get('code') !== 'good-code') return send(400, { error: 'invalid_grant' });
    } else if (p.get('grant_type') === 'refresh_token') {
      if (p.get('refresh_token') !== 'rt') return send(400, { error: 'invalid_grant' });
      seen.refreshed = true;
    }
    issued++; return send(200, { access_token: `at${issued}`, refresh_token: 'rt', token_type: 'Bearer' });
  }
  const auth = req.headers.authorization ?? '';
  if (expireNext && auth === `Bearer at${issued}`) { expireNext = false; return send(401, { error: 'invalid token' }); }
  if (auth !== `Bearer at${issued}`) return send(401, { error: 'invalid token' });
  if (u.pathname === '/api/workers/me') return send(200, workers[1]); // limited user: few fields
  if (u.pathname === '/api/workers') {
    const s = (u.searchParams.get('search') ?? '').toLowerCase();
    const d = workers.filter(w => w.descriptor.toLowerCase().includes(s));
    return send(200, { total: d.length, data: d.slice(0, Number(u.searchParams.get('limit') ?? 20)) });
  }
  send(404, { error: 'not found' });
});
await new Promise(r => fake.listen(FAKE, '127.0.0.1', r));

const env = { ...process.env, NO_PROXY: '*', no_proxy: '*', HTTPS_PROXY: '', HTTP_PROXY: '', https_proxy: '', http_proxy: '',
  WORKDAY_AUTHORIZE_URL: `http://127.0.0.1:${FAKE}/t/authorize`, WORKDAY_TOKEN_URL: `http://127.0.0.1:${FAKE}/t/token`,
  WORKDAY_REST_URL: `http://127.0.0.1:${FAKE}/api`, WORKDAY_CLIENT_ID: 'cid', WORKDAY_CLIENT_SECRET: SECRET,
  WORKDAY_REDIRECT_URI: `http://localhost:${CB}/oauth/callback` };
const client = new Client({ name: 'smoke', version: '0' });
await client.connect(new StdioClientTransport({ command: 'node', args: ['dist/index.js'], env, stderr: 'ignore' }));
const text = r => r.content[0].text;
const ok = (name) => console.log(`PASS ${name}`);

const tools = (await client.listTools()).tools.map(t => t.name).sort();
assert.deepEqual(tools, ['find_workers', 'get_my_profile']); ok('lists 2 tools');

const first = await client.callTool({ name: 'get_my_profile', arguments: {} });
assert.equal(first.isError, true);
const link = new URL(text(first).match(/https?:\/\/\S+/)[0]);
assert.equal(link.searchParams.get('code_challenge_method'), 'S256');
assert.equal(link.searchParams.get('client_id'), 'cid');
challenge = link.searchParams.get('code_challenge'); ok('no token -> login link with PKCE');

const bad = await fetch(`http://127.0.0.1:${CB}/oauth/callback?code=good-code&state=wrong`);
assert.equal(bad.status, 400); ok('callback rejects wrong state');
const again = await client.callTool({ name: 'get_my_profile', arguments: {} });
assert.equal(new URL(text(again).match(/https?:\/\/\S+/)[0]).href, link.href); ok('same login link while a login is pending');
const state = link.searchParams.get('state');
const cb = await fetch(`http://127.0.0.1:${CB}/oauth/callback?code=good-code&state=${state}`);
assert.equal(cb.status, 200);
assert.ok(seen.basic, 'secret sent as HTTP Basic'); assert.ok(seen.verifierOk, 'PKCE verifier matches');
ok('callback swaps code for token (Basic auth + PKCE verifier)');

const me = JSON.parse(text(await client.callTool({ name: 'get_my_profile', arguments: {} })));
assert.equal(me.descriptor, 'Kelly Brown'); assert.equal(me.primaryWorkEmail, undefined);
ok('get_my_profile returns the user record, missing fields left missing');

const found = JSON.parse(text(await client.callTool({ name: 'find_workers', arguments: { search: 'logan', limit: 5 } })));
assert.equal(found.total, 1); assert.equal(found.data[0].id, 'w1'); ok('find_workers searches');

expireNext = true;
const afterExpiry = JSON.parse(text(await client.callTool({ name: 'find_workers', arguments: {} })));
assert.equal(afterExpiry.total, 2); assert.ok(seen.refreshed); ok('401 -> refresh -> retry succeeds');

const out = JSON.stringify(await client.callTool({ name: 'find_workers', arguments: {} }));
assert.ok(!out.includes(SECRET) && !out.includes('rt"')); ok('no secret or refresh token in tool output');

await client.close(); fake.close();
console.log('ALL PASSED');
