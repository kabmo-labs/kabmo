/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MCP settings route's write contract: every mutating answer carries the
 * list it just changed.
 *
 * WHY this has its own suite: three branches returned `json({ servers:
 * mergeServers(...) })` WITHOUT `await`. JSON.stringify turns a Promise into
 * `{}` rather than failing, so the response was a 200 with `servers: {}` — the
 * save landed in `mcp.json` and on disk, while the panel reading its own answer
 * emptied the list. A missing `await` is invisible to the type checker (the
 * value is `unknown` to `json()`) and invisible at runtime except as an empty
 * collection, so every branch that reports the list is pinned here.
 *
 * Everything runs against a temp agent dir: no case may spawn `omp` or touch the
 * developer's real `~/.omp`.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDb } from '@/server/db.server';
import { action as mcpAction, loader as mcpLoader } from '@/server/routes/settings/mcp';
import type { McpServerItem } from '@/shared/types';
import { removeDir } from '@/test-support/remove-dir';

const ROOT = path.join(os.tmpdir(), 'omc-settings-mcp-route-test');
const AGENT_DIR = path.join(ROOT, 'agent');
const MCP_JSON = path.join(AGENT_DIR, 'mcp.json');
const API = 'http://localhost/api/settings';

beforeEach(() => {
  removeDir(ROOT);
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = AGENT_DIR;
  Bun.env.KABMO_DB_PATH = path.join(ROOT, 'db.sqlite');
  Bun.env.SYNC_WORKSPACE = 'false';
  delete Bun.env.MOCK;
  globalThis.__kabmoDb = undefined;
});

afterAll(async () => {
  await getDb();
  globalThis.__kabmoDb?.resolved?.raw.close();
  globalThis.__kabmoDb = undefined;
  delete Bun.env.PI_CODING_AGENT_DIR;
  delete Bun.env.KABMO_DB_PATH;
  delete Bun.env.SYNC_WORKSPACE;
  removeDir(ROOT);
});

type Handler = (args: never) => unknown;

function call(handler: Handler, request: Request): Promise<Response> {
  return handler({ request, params: {} } as never) as Promise<Response>;
}

function send(method: string, body?: unknown): Request {
  return new Request(`${API}/mcp`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
}

function server(name: string): McpServerItem {
  return {
    id: `mcp-${name}`,
    name,
    scope: 'every-project',
    enabled: true,
    reachType: 'command',
    commandArgs: ['bunx', '@modelcontextprotocol/server-everything'],
    envVars: [],
  };
}

describe('MCP route write answers', () => {
  test('a create answers with the list, not an empty object', async () => {
    const res = await call(mcpAction, send('POST', { server: server('first') }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.servers)).toBe(true);
    expect(body.servers.map((item: McpServerItem) => item.name)).toEqual(['first']);
    // The file is the record omp reads, so both sides must agree.
    expect(JSON.parse(fs.readFileSync(MCP_JSON, 'utf8')).mcpServers.first.command).toBe('bunx');
  });

  test('a legacy { scope: "user", name, server } write answers with the list', async () => {
    const res = await call(mcpAction, send('POST', {
      scope: 'user',
      name: 'legacy',
      server: server('legacy'),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.servers)).toBe(true);
    expect(body.servers.map((item: McpServerItem) => item.name)).toEqual(['legacy']);
  });

  test('a whole-list PUT answers with the list', async () => {
    const res = await call(mcpAction, send('PUT', { servers: [server('a'), server('b')] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.servers)).toBe(true);
    expect(body.servers.map((item: McpServerItem) => item.name).sort()).toEqual(['a', 'b']);
  });

  test('a delete answers with the list it left behind', async () => {
    await call(mcpAction, send('POST', { server: server('gone') }));
    const list = await (await call(mcpLoader, new Request(`${API}/mcp`))).json();
    const id = list.servers[0].id as string;

    const res = await call(mcpAction, new Request(`${API}/mcp?id=${encodeURIComponent(id)}`, { method: 'DELETE' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.servers)).toBe(true);
    expect(body.servers).toEqual([]);
  });

  test('a rename leaves one entry, not two', async () => {
    await call(mcpAction, send('POST', { server: server('before') }));
    await call(mcpAction, send('POST', { server: { ...server('after'), id: 'omp-user-before' } }));
    const body = await (await call(mcpLoader, new Request(`${API}/mcp`))).json();
    expect(body.servers.map((item: McpServerItem) => item.name)).toEqual(['after']);
    expect(Object.keys(JSON.parse(fs.readFileSync(MCP_JSON, 'utf8')).mcpServers)).toEqual(['after']);
  });
});
