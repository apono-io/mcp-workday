#!/usr/bin/env node
// Workday MCP server (prototype): two read tools over the standard Workday REST API, per-user OAuth.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { WorkdayAuth, LoginRequired } from './auth.js';
import { WorkdayClient } from './workday.js';

const cfg = loadConfig();
const client = new WorkdayClient(cfg, new WorkdayAuth(cfg));
const NOTE = 'Workday returns only the fields the logged-in user may see; a missing field means no permission, not empty data.';

async function run(fn: () => Promise<unknown>) {
  try {
    return { content: [{ type: 'text' as const, text: JSON.stringify(await fn(), null, 2) }] };
  } catch (e) {
    const text = e instanceof LoginRequired ? e.message : `Error: ${(e as Error).message}`;
    return { content: [{ type: 'text' as const, text }], isError: true };
  }
}

const server = new McpServer({ name: 'mcp-workday', version: '0.1.0' });

server.registerTool('get_my_profile', {
  title: 'Get my Workday profile',
  description: `Get the logged-in user's own Workday worker record (GET /workers/me). ${NOTE}`,
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, async () => run(() => client.get('/workers/me')));

server.registerTool('find_workers', {
  title: 'Find Workday workers',
  description: `Search workers by name or text (GET /workers). Returns up to "limit" workers and the total count. ${NOTE}`,
  inputSchema: {
    search: z.string().max(200).optional().describe('Text to search for, for example a name. Omit to list workers.'),
    limit: z.number().int().min(1).max(100).default(20).describe('Max workers to return (1-100).'),
    offset: z.number().int().min(0).default(0).describe('Workers to skip, for paging.'),
  },
  annotations: { readOnlyHint: true },
}, async ({ search, limit, offset }) => run(() => client.get('/workers', { search, limit, offset })));

await server.connect(new StdioServerTransport());
