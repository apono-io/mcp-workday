# mcp-workday

An MCP server that lets an AI assistant read Workday data **as the person who is logged in**, through Apono.
Apono grants the access for a limited time. Workday decides which fields each person sees.

It uses the standard Workday REST API. It does not need Workday Extend. It needs **no client secret**.

Status: prototype. Two read tools.

## What it does

| Tool | What it returns |
|---|---|
| `get_my_profile` | Your own Workday worker record |
| `find_workers` | Workers matching a name or text, with the total count |

Workday limits data **by field**. If you lack rights to a field, Workday leaves it out. A missing field
means "no permission", not "empty".

## What you need

- A Workday admin who can run **Register API Client** (Part 1).
- An Apono admin who can add an integration, an access flow and an MCP server (Part 3).
- On each user's laptop: **Node 18 or newer** and the **local Apono agentic gateway**. Nothing else to install or run.

**The local Apono agentic gateway is required.** This server runs on the user's own laptop, and the local
gateway is what starts it. It does not work through Apono's remote (hosted) gateway.

To install the local gateway in Claude Code, run this once and then sign in to Apono when asked:

```bash
claude mcp add apono -- npx -y @apono-io/apono-mcp@latest --agent-type claude-code --proxy
```
- Port **8976** free on the laptop while someone logs in.

## Part 1: Workday admin, once

1. In Workday, run the task **Register API Client**. (Not "for Integrations".)
2. Fill in:

   | Field | Value |
   |---|---|
   | Client Name | Any name, for example `Apono Workday MCP` |
   | Client Grant Type | **Authorization Code Grant** |
   | Support Proof Key for Code Exchange (PKCE) | **Ticked** |
   | Redirection URI | `https://apono-io.github.io/mcp-workday/callback.html` (exactly this) |
   | Non-Expiring Refresh Tokens | **No**. A login then ends by itself, and the user logs in again when asked. |
   | Scope (Functional Areas) | **Staffing** and **Personal Data** |

3. Save. If Workday shows a client secret for this client, ignore it. Do not copy it. Apono never uses it.
4. Run the report **View API Clients** and open your new client. Copy these four values for the Apono admin:

   | Value | Looks like |
   |---|---|
   | Client ID | a long text |
   | Authorization Endpoint | `https://<host>.wdNNN.myworkday.com/<tenant>/authorize` |
   | Token Endpoint | `https://<host>-services1.wdNNN.myworkday.com/ccx/oauth2/<tenant>/token` |
   | Workday REST API Endpoint | `https://<host>-services1.wdNNN.myworkday.com/ccx/api/v1/<tenant>` |

## Part 2: How the login returns to the laptop (nothing to do)

Workday only sends users back to an **https** address. The server on the laptop speaks plain http. So the
Redirection URI is a small static page, `https://apono-io.github.io/mcp-workday/callback.html`. It is the file
`docs/callback.html` in this repo, served by GitHub Pages. It does one thing: it forwards the browser to
`http://localhost:8976` on the user's own laptop, where the server finishes the login.

The page sees a one-time login code in its address. That code is useless without a second value that never
leaves the laptop (PKCE).

## Part 3: Apono admin, once

1. **Add the integration.** Choose **Workday (REST)**, and enter the four values from Part 1:
   Authorization Endpoint, Token Endpoint, Workday REST API Endpoint, OAuth Client ID.
   Leave **MCP Package** as it is (`github:apono-io/mcp-workday`), unless you run your own copy (see below).
   No secret is asked for.
2. **Add an access flow** for the people who may use it:
   - Target: the Workday (REST) integration.
   - Duration: for example 30 minutes.
   - Turn on **agentic access**.
3. **Enable the MCP server** **Workday REST MCP** for your account. It should show two tools:
   `get_my_profile` and `find_workers`.

## Part 4: First use

1. In the AI assistant, ask for Workday. The assistant asks Apono for access. The access flow approves it.
2. Ask: "Who am I in Workday?" The first answer is a **login link**.
3. Open the link in your browser. Log in to Workday as yourself.
4. The page says **Logged in to Workday**.
5. Ask again. Now the answer is your Workday profile.

The login stays until the server stops. It stops when the access ends or the assistant session ends. Then
you log in again. Tokens are kept in memory only. Nothing is written to disk.

## Different people see different data

Workday applies each person's own security. In our test, a plain employee saw 7 fields of their own record,
and a user with wide access saw 13. Apono does not change what Workday allows.

## Troubleshooting

| What you see | What to do |
|---|---|
| "Port 8976 is already in use" | Stop the program that uses it, then ask again. On macOS or Linux, `lsof -i :8976` shows which one. |
| After the Workday login the browser says it cannot connect to `localhost` | The server is not running, or the login took more than 5 minutes. Ask the assistant for a new link. |
| The login link does not work, or is old | Ask the assistant for a new link. Finish the login in one browser window. |
| The login page opens but Workday shows an error | Check the Redirection URI in Workday. It must be exactly `https://apono-io.github.io/mcp-workday/callback.html`. |
| You see fewer fields than you expect | Workday leaves out fields you may not see. Ask your Workday admin about your security rights. |
| "login timed out" | You have 5 minutes to log in. Ask for a new link. |
| "This target could not be started" | Check that **MCP Package** on the integration is filled in and names a real package. After you change the integration, end the active access and request it again. |
| The first connection takes a while | The first start downloads the server (about 15 seconds). Later starts are faster. |

## Running your own copy (fork)

You can fork this repo and change the code, for example to add tools.

1. Fork the repo on GitHub and make your changes.
2. In Apono, edit the Workday (REST) integration. Set **MCP Package** to `github:<your-org>/<your-repo>`.
   To pin a version, add a tag: `github:<your-org>/<your-repo>#v1.0.0`.
3. End any active Workday access in Apono, then request access again. The new value is used from the next access.

The package must stay startable with `npx`: keep the `bin` entry and the `prepare` script in `package.json`.
The Redirection URI can stay the same. The page only forwards the browser to the user's own laptop, so it
works for a fork too. Tools you add also need an entry in Apono's catalog before the assistant can see
them. Ask Apono for that.

## The port

The login uses port 8976 on the laptop. It is fixed in this version.

## Limits

- Two read tools only.
- You log in again whenever the server restarts.
- Prototype.

## For developers

Source is in `src/`: `index.ts` (tools), `auth.ts` (login, tokens, refresh), `config.ts` (settings),
`workday.ts` (REST calls).

Settings are environment variables. The Apono entry sets them for you.

| Variable | Required | Notes |
|---|---|---|
| `WORKDAY_AUTHORIZE_URL` | yes | Authorization Endpoint |
| `WORKDAY_TOKEN_URL` | yes | Token Endpoint |
| `WORKDAY_REST_URL` | yes | Workday REST API Endpoint |
| `WORKDAY_CLIENT_ID` | yes | OAuth client ID |
| `WORKDAY_CLIENT_SECRET` | no | Only for a client with a secret. Leave unset for PKCE. |
| `WORKDAY_USE_PKCE` | no | Default `true`. `false` turns it off. |
| `WORKDAY_REDIRECT_URI` | no | Must match the Workday client. The Apono entry sets `https://apono-io.github.io/mcp-workday/callback.html`. Default `http://localhost:8976/oauth/callback` (Workday refuses http). |
| `WORKDAY_LISTEN_PORT` | no | Default 8976 with a page address; with a `localhost` redirect, that address's port |
| `WORKDAY_TLS_CERT_FILE`, `WORKDAY_TLS_KEY_FILE` | no | Only for a redirect to `https://localhost...` without the page. Default: `~/.apono/mcp-workday/cert.pem` and `key.pem` |
| `WORKDAY_LOGIN_TIMEOUT_MS` | no | Default `300000` |

```bash
npm install
npm run smoke   # builds, then runs test/smoke.mjs against a fake Workday (no network, no secret)
```

## License

Apache-2.0. See `LICENSE`.
