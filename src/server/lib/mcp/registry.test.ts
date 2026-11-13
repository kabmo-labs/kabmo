/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MCP list a session receives.
 *
 * The bug this pins: the settings pane read omp's `mcp.json`, the ACP spawn
 * passed `mcpServers: []`, and a plugin had no way to contribute — so a server
 * the user configured reached exactly one harness. These tests drive the merge
 * over a temp agent dir, a temp project and an isolated database.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import {
  definitionFromItem,
  definitionFromNative,
  mcpServersFor,
  toAcpMcpServers,
} from '@/server/lib/mcp/registry.server';
import { writeCustomMcpServers } from '@/server/lib/mcp/store.server';
import { clearPluginMcp, createPluginMcp } from '@/server/lib/plugins/mcp.server';
import { getDb } from '@/server/db.server';
import type { McpServerItem } from '@/shared/types';

let root = '';
let agentDir = '';
let project = '';
const previousAgentDir = Bun.env.PI_CODING_AGENT_DIR;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'kabmo-mcp-registry-'));
  agentDir = join(root, 'agent');
  project = join(root, 'project');
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(project, '.omp'), { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
  await isolateDb();
});

afterAll(async () => {
  await releaseDb();
  if (previousAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

function item(overrides: Partial<McpServerItem> = {}): McpServerItem {
  return {
    id: 'custom-1',
    name: 'custom',
    scope: 'every-project',
    enabled: true,
    transport: 'stdio',
    commandArgs: ['npx', '-y', 'custom-mcp'],
    envVars: [],
    headers: [],
    ...overrides,
  };
}

describe('definitionFromNative', () => {
  test('a command entry becomes a stdio server', () => {
    expect(definitionFromNative('notes', { command: 'npx', args: ['-y', 'notes'], env: { TOKEN: 'x' } })).toEqual({
      name: 'notes',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'notes'],
      env: { TOKEN: 'x' },
    });
  });

  test('a url entry becomes an http server', () => {
    expect(definitionFromNative('remote', { url: 'https://mcp.example/sse', headers: { Authorization: 'Bearer x' } })).toEqual({
      name: 'remote',
      transport: 'http',
      url: 'https://mcp.example/sse',
      headers: { Authorization: 'Bearer x' },
    });
  });

  test('an sse entry keeps its transport, and timeout/cwd survive', () => {
    expect(definitionFromNative('legacy', { type: 'sse', url: 'https://x/sse', timeout: 5000 })).toEqual({
      name: 'legacy',
      transport: 'sse',
      url: 'https://x/sse',
      timeout: 5000,
    });
    expect(definitionFromNative('local', { command: 'x', cwd: '/tmp/w', timeout: 0 })).toEqual({
      name: 'local',
      transport: 'stdio',
      command: 'x',
      cwd: '/tmp/w',
      timeout: 0,
    });
  });

  test('an entry naming neither is dropped, not guessed at', () => {
    expect(definitionFromNative('broken', {})).toBeNull();
  });
});

describe('definitionFromItem', () => {
  test('a disabled row is not injected', () => {
    expect(definitionFromItem(item({ enabled: false }))).toBeNull();
  });

  test('a masked credential is never injected as the literal dots', () => {
    const definition = definitionFromItem(
      item({ envVars: [{ id: '1', key: 'TOKEN', value: '••••••••' }, { id: '2', key: 'MODE', value: 'fast' }] }),
    );
    expect(definition?.env).toEqual({ MODE: 'fast' });
  });

  test('a link row becomes an http server with its headers', () => {
    expect(
      definitionFromItem(
        item({
          transport: 'http',
          linkUrl: 'https://mcp.example',
          headers: [{ id: 'h1', key: 'Authorization', value: 'Bearer x' }],
          timeout: 1000,
        }),
      ),
    ).toEqual({
      name: 'custom',
      transport: 'http',
      url: 'https://mcp.example',
      headers: { Authorization: 'Bearer x' },
      timeout: 1000,
    });
  });

  test('an sse row keeps the sse transport', () => {
    expect(definitionFromItem(item({ transport: 'sse', linkUrl: 'https://x/sse' }))).toMatchObject({
      transport: 'sse',
      url: 'https://x/sse',
    });
  });

  test('a stdio row carries cwd and timeout', () => {
    expect(definitionFromItem(item({ cwd: '/tmp/w', timeout: 0 }))).toMatchObject({
      transport: 'stdio',
      cwd: '/tmp/w',
      timeout: 0,
    });
  });
});

describe('toAcpMcpServers', () => {
  test('maps all transports to the wire shape', () => {
    expect(
      toAcpMcpServers([
        { name: 'a', transport: 'stdio', command: 'npx', args: ['x'], env: { K: 'V' } },
        { name: 'b', transport: 'http', url: 'https://x', headers: { H: '1' } },
        { name: 'c', transport: 'sse', url: 'https://y/sse' },
      ]),
    ).toEqual([
      { name: 'a', command: 'npx', args: ['x'], env: [{ name: 'K', value: 'V' }] },
      { type: 'http', name: 'b', url: 'https://x', headers: [{ name: 'H', value: '1' }] },
      { type: 'sse', name: 'c', url: 'https://y/sse', headers: [] },
    ]);
  });
});

describe('mcpServersFor', () => {
  test('merges user, project, app-local and plugin servers, first name wins', async () => {
    await writeFile(
      join(agentDir, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          shared: { command: 'user-command' },
          off: { command: 'disabled-command' },
        },
        disabledServers: ['off'],
      }),
    );
    await writeFile(
      join(project, '.omp', 'mcp.json'),
      JSON.stringify({ mcpServers: { project: { command: 'project-command' } } }),
    );
    await writeCustomMcpServers(await getDb(), [
      item({ id: 'shared', name: 'shared', commandArgs: ['custom-command'] }),
      item({ id: 'local', name: 'local', commandArgs: ['local-command'] }),
    ]);
    const plugin = createPluginMcp('demo');
    plugin.register({ id: 'tools', transport: 'stdio', command: 'plugin-command' });

    try {
      const servers = await mcpServersFor(project);
      expect(servers.map((server) => server.name)).toEqual(['shared', 'project', 'local', 'demo:tools']);
      // The user's entry wins over the app-local row of the same name.
      expect(servers[0]?.command).toBe('user-command');
      expect(servers.some((server) => server.name === 'off')).toBe(false);
    } finally {
      clearPluginMcp('demo');
    }
  });

  test('a project-scoped row is only injected into its own project', async () => {
    await writeCustomMcpServers(await getDb(), [
      item({ id: 'scoped', name: 'scoped', scope: 'this-project', projectPath: project }),
    ]);
    const elsewhere = join(root, 'elsewhere');
    await mkdir(elsewhere, { recursive: true });
    expect((await mcpServersFor(project)).some((server) => server.name === 'scoped')).toBe(true);
    expect((await mcpServersFor(elsewhere)).some((server) => server.name === 'scoped')).toBe(false);
  });

  test('a server disabled in the file or in the denylist never reaches a session', async () => {
    await writeFile(
      join(agentDir, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          off: { command: 'off-command', enabled: false },
          denied: { command: 'denied-command' },
          allowed: { command: 'allowed-command', enabled: false },
        },
        disabledServers: ['denied'],
        enabledServers: ['allowed'],
      }),
    );
    await writeCustomMcpServers(await getDb(), []);
    expect((await mcpServersFor('')).map((server) => server.name)).toEqual(['allowed']);
  });

  test('mcp.enableProjectConfig=false hides the project file from a session', async () => {
    await writeFile(join(agentDir, 'config.yml'), 'mcp:\n  enableProjectConfig: false\n');
    try {
      expect((await mcpServersFor(project)).some((server) => server.name === 'project')).toBe(false);
    } finally {
      await rm(join(agentDir, 'config.yml'), { force: true });
    }
    expect((await mcpServersFor(project)).some((server) => server.name === 'project')).toBe(true);
  });
});
