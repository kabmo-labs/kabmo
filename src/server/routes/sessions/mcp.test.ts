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
import { forgetProbe, rememberProbe } from '@/server/lib/harness/probe-cache.server';
import { UNPROBED_CAPABILITIES } from '@/server/lib/harness/capabilities';
import { getSessionMcp, probeSessionMcp, setSessionMcp } from '@/server/routes/sessions/mcp';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import type { SessionMcpPayload } from '@/shared/types';

const ROOT = path.join(os.tmpdir(), `kabmo-session-mcp-route-${process.pid}`);
const AGENT = path.join(ROOT, 'agent');
const PROJECT = path.join(ROOT, 'project');
const XDG = path.join(ROOT, 'xdg');
const SESSION = '11111111-2222-3333-4444-555555555555';
const ACP_SESSION = '99999999-8888-7777-6666-555555555555';
const previousAgentDir = Bun.env.PI_CODING_AGENT_DIR;
const previousXdg = Bun.env.XDG_CONFIG_HOME;

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
  fs.mkdirSync(path.join(XDG, 'opencode'), { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = AGENT;
  Bun.env.XDG_CONFIG_HOME = XDG;
  fs.writeFileSync(
    path.join(AGENT, 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        alpha: { command: 'alpha-cmd' },
        beta: { command: 'beta-cmd' },
        delta: { type: 'http', url: 'http://127.0.0.1:1/mcp' },
      },
    }),
  );
  fs.writeFileSync(
    path.join(PROJECT, '.omp', 'mcp.json'),
    JSON.stringify({ mcpServers: { gamma: { command: 'gamma-cmd' } } }),
  );
  // opencode's own config: a server Kabmo never injects, which the list must
  // still show for an ACP chat. `opencode.json` is not one of Kabmo's sources.
  fs.writeFileSync(
    path.join(XDG, 'opencode', 'opencode.json'),
    JSON.stringify({ mcp: { agentOnly: { type: 'local', command: ['agent-cmd'] } } }),
  );
});

afterAll(async () => {
  await forgetProbe('opencode');
  await releaseDb();
  if (previousAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousXdg === undefined) delete Bun.env.XDG_CONFIG_HOME;
  else Bun.env.XDG_CONFIG_HOME = previousXdg;
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
    expect(data.servers.map((server) => server.name)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    expect(data.servers.every((server) => server.enabled)).toBe(true);
    // Nothing has been probed yet: the status is unknown, never a green dot.
    expect(data.servers.every((server) => server.probe === null)).toBe(true);
    expect(data.servers.find((server) => server.name === 'gamma')?.source).toBe('project');
  });

  test('an ACP harness lists only the transports its agent advertised', async () => {
    await saveHarnessSession({ sessionId: ACP_SESSION, harness: 'opencode', agentSessionId: '', cwd: PROJECT });
    const acpArgs = {
      params: { sessionId: ACP_SESSION },
      request: new Request(`http://localhost/api/sessions/${ACP_SESSION}/mcp`),
    } as LoaderFunctionArgs;

    await rememberProbe('opencode', {
      harness: 'opencode',
      capabilities: { ...UNPROBED_CAPABILITIES, mcpCapabilities: { http: false, sse: false } },
      models: [],
      thinking: [],
      modes: [],
      probedAt: Date.now(),
    });
    const withoutHttp = (await (await getSessionMcp(acpArgs)).json()) as SessionMcpPayload;
    expect(withoutHttp.delivery).toBe('acp');
    expect(withoutHttp.servers.map((server) => server.name)).toEqual(['alpha', 'beta', 'gamma', 'agentOnly']);
    expect(withoutHttp.servers.find((server) => server.name === 'agentOnly')?.source).toBe('agent');

    await rememberProbe('opencode', {
      harness: 'opencode',
      capabilities: { ...UNPROBED_CAPABILITIES, mcpCapabilities: { http: true, sse: false } },
      models: [],
      thinking: [],
      modes: [],
      probedAt: Date.now(),
    });
    const withHttp = (await (await getSessionMcp(acpArgs)).json()) as SessionMcpPayload;
    expect(withHttp.servers.map((server) => server.name)).toEqual(['alpha', 'beta', 'delta', 'gamma', 'agentOnly']);
  });

  test('an agent-owned server cannot be toggled from Kabmo', async () => {
    await saveHarnessSession({ sessionId: ACP_SESSION, harness: 'opencode', agentSessionId: '', cwd: PROJECT });
    const response = await setSessionMcp({
      params: { sessionId: ACP_SESSION },
      request: new Request(`http://localhost/api/sessions/${ACP_SESSION}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'agentOnly', enabled: false }),
      }),
    } as ActionFunctionArgs);
    expect(response.status).toBe(409);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain('configured by the agent');
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
