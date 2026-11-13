/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET/POST /api/sessions/:sessionId/mcp` — the list a session has and the
 * per-session switch.
 *
 * The route is called directly, as the other route tests do. The database is a
 * temp SQLite file and `PI_CODING_AGENT_DIR` a temp tree, so the merge and the
 * override store are exercised for real while nothing outside `/tmp` is read.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';
import { saveHarnessSession } from '@/server/lib/harness/session-store.server';
import { getSessionMcp, probeSessionMcp, setSessionMcp } from '@/server/routes/sessions/mcp';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import type { SessionMcpPayload } from '@/shared/types';

const ROOT = path.join(os.tmpdir(), `kabmo-session-mcp-route-${process.pid}`);
const AGENT = path.join(ROOT, 'agent');
const PROJECT = path.join(ROOT, 'project');
const SESSION = '11111111-2222-3333-4444-555555555555';
const previousAgentDir = Bun.env.PI_CODING_AGENT_DIR;

/** The POST answer: the list plus what the server did with the change. */
interface SetSessionMcpResponse extends SessionMcpPayload {
  success: boolean;
  applied: boolean;
  appliesOnNextSpawn: boolean;
}

beforeAll(async () => {
  removeDir(ROOT);
  fs.mkdirSync(AGENT, { recursive: true });
  fs.mkdirSync(path.join(PROJECT, '.omp'), { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = AGENT;
  fs.writeFileSync(
    path.join(AGENT, 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        alpha: { command: 'alpha-cmd' },
        beta: { command: 'beta-cmd' },
      },
    }),
  );
  fs.writeFileSync(
    path.join(PROJECT, '.omp', 'mcp.json'),
    JSON.stringify({ mcpServers: { gamma: { command: 'gamma-cmd' } } }),
  );
});

afterAll(async () => {
  await releaseDb();
  if (previousAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = previousAgentDir;
  removeDir(ROOT);
});

beforeEach(async () => {
  await isolateDb();
  await saveHarnessSession({ sessionId: SESSION, harness: 'omp-rpc', agentSessionId: '', cwd: PROJECT });
});

function loaderArgs(): LoaderFunctionArgs {
  return {
    params: { sessionId: SESSION },
    request: new Request(`http://localhost/api/sessions/${SESSION}/mcp`),
  } as LoaderFunctionArgs;
}

function actionArgs(body: unknown, method = 'POST'): ActionFunctionArgs {
  return {
    params: { sessionId: SESSION },
    request: new Request(`http://localhost/api/sessions/${SESSION}/mcp`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
  } as ActionFunctionArgs;
}

async function readList(): Promise<SessionMcpPayload> {
  const response = await getSessionMcp(loaderArgs());
  expect(response.status).toBe(200);
  return (await response.json()) as SessionMcpPayload;
}

describe('GET /api/sessions/:sessionId/mcp', () => {
  test('lists the file-backed servers with their configured state', async () => {
    const data = await readList();
    expect(data.delivery).toBe('omp-config');
    expect(data.harness).toBe('omp-rpc');
    expect(data.servers.map((server) => server.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(data.servers.every((server) => server.enabled)).toBe(true);
    // Nothing has been probed yet: the status is unknown, never a green dot.
    expect(data.servers.every((server) => server.probe === null)).toBe(true);
    expect(data.servers.find((server) => server.name === 'gamma')?.source).toBe('project');
  });
});

describe('POST /api/sessions/:sessionId/mcp', () => {
  test('disables one server for this session and persists the override', async () => {
    const response = await setSessionMcp(actionArgs({ name: 'beta', enabled: false }));
    expect(response.status).toBe(200);
    const data = (await response.json()) as SetSessionMcpResponse;
    expect(data.overrides).toEqual({ beta: false });
    expect(data.servers.find((server) => server.name === 'beta')?.enabled).toBe(false);

    const reread = await readList();
    expect(reread.servers.find((server) => server.name === 'beta')?.enabled).toBe(false);
  });

  test('toggling back to the configured state removes the override', async () => {
    await setSessionMcp(actionArgs({ name: 'beta', enabled: false }));
    const response = await setSessionMcp(actionArgs({ name: 'beta', enabled: true }));
    const data = (await response.json()) as SetSessionMcpResponse;
    expect(data.overrides).toEqual({});
  });

  test('an unknown server is refused by name', async () => {
    const response = await setSessionMcp(actionArgs({ name: 'nope', enabled: false }));
    expect(response.status).toBe(404);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain('nope');
  });

  test('a non-POST verb is a 405', async () => {
    const response = await setSessionMcp(actionArgs(null, 'GET'));
    expect(response.status).toBe(405);
  });
});

describe('POST /api/sessions/:sessionId/mcp/probe', () => {
  test('a disabled server is refused without spawning it', async () => {
    await setSessionMcp(actionArgs({ name: 'beta', enabled: false }));
    const response = await probeSessionMcp(actionArgs({ name: 'beta' }));
    expect(response.status).toBe(200);
    const data = (await response.json()) as { ok: boolean; error?: string };
    expect(data.ok).toBe(false);
    expect(data.error).toBe('Disabled for this session');
  });

  test('an unknown server is refused by name', async () => {
    const response = await probeSessionMcp(actionArgs({ name: 'nope' }));
    expect(response.status).toBe(404);
  });
});
