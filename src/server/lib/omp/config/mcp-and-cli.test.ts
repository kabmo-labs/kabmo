/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MCP config mapping/validation, the MCP test-connection decision, the
 * path-scoped setting resolver, and the two CLI bridges' pure parts.
 *
 * Pinned because each decides on untrusted or hand-written input:
 * - `nativeToServerItem` maps a native entry to Kabmo shape; a wrong
 *   reach type or a dropped env var makes the UI test a server it cannot run.
 * - `writeUserMcpServer` must preserve credentials the browser redacted, and
 *   must reject a name that could escape the file's own key grammar.
 * - `testMcpServer` classifies an unusable configuration WITHOUT spawning
 *   anything, so the route answers with a useful error rather than a 500.
 * - `resolvePathScopedSlugs` must not flatten per-project policy: an object
 *   entry applies only when its prefix contains the cwd.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  MCP_FILENAMES,
  deleteUserMcpServer,
  nativeToServerItem,
  readProjectMcpConfig,
  readUserMcpConfig,
  redactEnvVars,
  resolveProjectMcpConfig,
  writeUserMcpServer,
} from '@/server/lib/omp/config/mcp';
import { testMcpServer } from '@/server/lib/omp/config/mcp-test';
import { isPathScopedEntry, pathScopedEntryValues, resolvePathScopedSlugs } from '@/server/lib/omp/config/path-scoped';
import { pluginCliError } from '@/server/lib/omp/config/plugin-cli';
import { getOmpConfigValue, listOmpConfig, resetOmpConfigKey, setOmpConfigValue } from '@/server/lib/omp/config/config-cli';

const roots: string[] = [];
const originalMock = Bun.env.MOCK;

async function tempDir(): Promise<string> {
  const dir = await fs.promises.mkdtemp(join(tmpdir(), 'omp-mcp-'));
  roots.push(dir);
  return dir;
}

afterAll(async () => {
  if (originalMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = originalMock;
  for (const root of roots) await fs.promises.rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  // The default suite runs with real data; the mock branches are opted into
  // explicitly per test.
  Bun.env.MOCK = 'false';
});

describe('nativeToServerItem', () => {
  test('a command server becomes a command item with split args', () => {
    const item = nativeToServerItem('fs', { command: 'npx', args: ['-y', '@mcp/fs'] }, 2, true);
    expect(item).toEqual({
      id: 'omp-user-fs',
      name: 'fs',
      scope: 'every-project',
      enabled: true,
      reachType: 'command',
      commandArgs: ['npx', '-y', '@mcp/fs'],
      linkUrl: undefined,
      envVars: [],
      status: undefined,
    });
  });

  test('a url server becomes a link item and its env vars are stringified', () => {
    const item = nativeToServerItem('web', { url: 'https://mcp.example/sse', env: { A: 1, B: 'two' } }, 0, false);
    expect(item.reachType).toBe('link');
    expect(item.linkUrl).toBe('https://mcp.example/sse');
    expect(item.commandArgs).toEqual(['https://mcp.example/sse']);
    expect(item.envVars).toEqual([
      { id: 'env-0-0', key: 'A', value: '1' },
      { id: 'env-0-1', key: 'B', value: 'two' },
    ]);
  });

  test('a project-scoped item carries the project id and path', () => {
    const item = nativeToServerItem('fs', { command: 'x' }, 1, true, { path: '/proj' });
    expect(item.id).toBe('omp-project-fs');
    expect(item.scope).toBe('this-project');
    expect(item.projectPath).toBe('/proj');
  });

  test('an empty command yields no args rather than a blank entry', () => {
    expect(nativeToServerItem('blank', {}, 0, true).commandArgs).toEqual([]);
  });
});

describe('redactEnvVars', () => {
  test('values whose key looks sensitive are masked; others are untouched', () => {
    const vars = [
      { key: 'API_KEY', value: 'sk-secret' },
      { key: 'authToken', value: 'tok' },
      { key: 'db_password', value: 'pw' },
      { key: 'PLAIN', value: 'visible' },
    ];
    const out = redactEnvVars(vars);
    expect(out.map((v) => v.value)).toEqual(['••••••••', '••••••••', '••••••••', 'visible']);
    // Non-sensitive rows keep their identity (no needless copies).
    expect(out[3]).toBe(vars[3]);
  });
});

describe('mcp file read/write', () => {
  test('readUserMcpConfig on a missing file is empty and does not throw', async () => {
    const path = join(await tempDir(), 'mcp.json');
    expect(await readUserMcpConfig(path)).toEqual({ path, servers: [], disabledServers: [] });
  });

  test('readUserMcpConfig sorts servers by name and keeps only string disables', async () => {
    const path = join(await tempDir(), 'mcp.json');
    await Bun.write(path, JSON.stringify({
      mcpServers: { zeta: { command: 'z' }, alpha: { url: 'https://a' } },
      disabledServers: ['zeta', 7, null],
    }));
    const config = await readUserMcpConfig(path);
    expect(config.servers.map((s) => s.name)).toEqual(['alpha', 'zeta']);
    expect(config.disabledServers).toEqual(['zeta']);
  });

  test('readUserMcpConfig reports malformed content as an error field', async () => {
    const path = join(await tempDir(), 'mcp.json');
    await Bun.write(path, '[1,2,3]');
    expect((await readUserMcpConfig(path)).error).toBe('configuration must contain a JSON object');

    await Bun.write(path, '{"mcpServers": 5}');
    expect((await readUserMcpConfig(path)).error).toBe('mcpServers must be an object');

    await Bun.write(path, '{not json');
    expect((await readUserMcpConfig(path)).error).toBeTruthy();
  });

  test('resolveProjectMcpConfig picks the first existing candidate, else the default', async () => {
    const dir = await tempDir();
    expect((await resolveProjectMcpConfig(dir)).path).toBe(join(dir, MCP_FILENAMES[0]));

    await Bun.write(join(dir, 'mcp.json'), '{}');
    expect((await resolveProjectMcpConfig(dir)).path).toBe(join(dir, 'mcp.json'));

    await fs.promises.mkdir(join(dir, '.omp'), { recursive: true });
    await Bun.write(join(dir, '.omp', 'mcp.json'), '{}');
    expect((await resolveProjectMcpConfig(dir)).path).toBe(join(dir, '.omp', 'mcp.json'));
  });

  test('readProjectMcpConfig reads the resolved project file', async () => {
    const dir = await tempDir();
    await fs.promises.mkdir(join(dir, '.omp'), { recursive: true });
    await Bun.write(join(dir, '.omp', 'mcp.json'), '{"mcpServers":{"p":{"command":"x"}}}');
    expect((await readProjectMcpConfig(dir)).servers.map((s) => s.name)).toEqual(['p']);
  });

  test('writeUserMcpServer rejects a name outside the grammar and a non-object', async () => {
    const path = join(await tempDir(), 'mcp.json');
    await expect(writeUserMcpServer('bad name', { command: 'x' }, path)).rejects.toThrow('Invalid server name');
    await expect(writeUserMcpServer('ok', 'not an object' as unknown as Record<string, unknown>, path)).rejects.toThrow(
      'Server configuration must be an object',
    );
  });

  test('writeUserMcpServer preserves redacted env/headers the payload omitted', async () => {
    const path = join(await tempDir(), 'mcp.json');
    await Bun.write(path, JSON.stringify({
      mcpServers: { srv: { command: 'old', env: { KEY: 'sk-secret' }, headers: { Auth: 'Bearer x' } } },
    }));
    await writeUserMcpServer('srv', { command: 'new' }, path);

    const raw = JSON.parse(await fs.promises.readFile(path, 'utf8'));
    expect(raw.mcpServers.srv).toEqual({
      command: 'new',
      env: { KEY: 'sk-secret' },
      headers: { Auth: 'Bearer x' },
    });
  });

  test('writeUserMcpServer rename moves the entry and keeps its credentials', async () => {
    const path = join(await tempDir(), 'mcp.json');
    await Bun.write(path, JSON.stringify({ mcpServers: { old: { command: 'x', env: { K: 'v' } } } }));
    await writeUserMcpServer('new', { command: 'x' }, path, 'old');

    const raw = JSON.parse(await fs.promises.readFile(path, 'utf8'));
    expect(Object.keys(raw.mcpServers)).toEqual(['new']);
    expect(raw.mcpServers.new.env).toEqual({ K: 'v' });
  });

  test('deleteUserMcpServer removes an entry and refuses a missing one', async () => {
    const path = join(await tempDir(), 'mcp.json');
    await Bun.write(path, JSON.stringify({ mcpServers: { a: { command: 'x' } } }));
    await deleteUserMcpServer('a', path);
    expect(JSON.parse(await fs.promises.readFile(path, 'utf8')).mcpServers).toEqual({});

    await expect(deleteUserMcpServer('ghost', path)).rejects.toThrow('MCP server was not found');
    const missing = join(await tempDir(), 'nope.json');
    await expect(deleteUserMcpServer('a', missing)).rejects.toThrow('MCP server was not found');
  });
});

describe('testMcpServer decision logic (no spawn, no network)', () => {
  test('a link URL that is not http(s) is rejected without a request', async () => {
    const result = await testMcpServer({
      server: { id: '1', name: 'x', scope: 'every-project', enabled: true, reachType: 'link', commandArgs: [], linkUrl: 'ftp://x', envVars: [] },
    });
    expect(result).toEqual({
      ok: false,
      transport: 'link',
      durationMs: 0,
      error: 'Link URL must be a valid http(s) endpoint',
    });
  });

  test('a command server with no arguments is rejected without spawning', async () => {
    const result = await testMcpServer({
      server: { id: '1', name: 'x', scope: 'every-project', enabled: true, reachType: 'command', commandArgs: ['  '], envVars: [] },
    });
    expect(result.ok).toBe(false);
    expect(result.transport).toBe('command');
    expect(result.error).toBe('No command configured');
  });

  test('mock mode validates the configuration instead of connecting', async () => {
    Bun.env.MOCK = '1';
    const bad = await testMcpServer({
      server: { id: '1', name: 'x', scope: 'every-project', enabled: true, reachType: 'link', commandArgs: [], linkUrl: 'nope', envVars: [] },
    });
    expect(bad).toEqual({ ok: false, transport: 'link', durationMs: 12, error: 'Invalid server configuration' });

    const good = await testMcpServer({
      server: { id: '2', name: 'web', scope: 'every-project', enabled: true, reachType: 'link', commandArgs: [], linkUrl: 'https://mcp.example', envVars: [] },
    });
    expect(good).toEqual({
      ok: true,
      transport: 'link',
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'web', version: '1.0.0' },
      toolCount: 3,
      durationMs: 37,
    });
  });
});

describe('path-scoped settings', () => {
  const cwd = '/srv/work/proj/src';

  test('bare strings always apply; object entries only under a matching prefix', () => {
    const value = [
      'always',
      { path: '/srv/work/proj', values: ['inside'] },
      { paths: ['/srv/other'], items: ['outside'] },
      { pathPrefix: '/srv/work', providers: ['parent'] },
    ];
    expect(resolvePathScopedSlugs(value, cwd)).toEqual(['always', 'inside', 'parent']);
  });

  test('an object with no prefix is skipped, and non-arrays resolve to []', () => {
    expect(resolvePathScopedSlugs([{ values: ['x'] }], cwd)).toEqual([]);
    expect(resolvePathScopedSlugs('bare', cwd)).toEqual([]);
    expect(resolvePathScopedSlugs(null, cwd)).toEqual([]);
    // Sibling prefix does not match, so its values are dropped.
    expect(resolvePathScopedSlugs([{ path: '/srv/work/proj-extra', values: ['x'] }], cwd)).toEqual([]);
  });

  test('a prefix equal to the cwd itself matches', () => {
    expect(resolvePathScopedSlugs([{ path: cwd, values: ['here'] }], cwd)).toEqual(['here']);
  });

  test('isPathScopedEntry distinguishes an object entry from a bare slug', () => {
    expect(isPathScopedEntry('bare')).toBe(false);
    expect(isPathScopedEntry(null)).toBe(false);
    expect(isPathScopedEntry({ values: ['x'] })).toBe(false);
    expect(isPathScopedEntry({ path: '/x' })).toBe(true);
    expect(isPathScopedEntry({ pathPrefixes: [] })).toBe(true);
  });

  test('pathScopedEntryValues reads the value keys regardless of prefixes', () => {
    expect(pathScopedEntryValues({ path: '/x', values: ['a'], items: ['b'], providers: ['c'] })).toEqual(['a', 'b', 'c']);
    expect(pathScopedEntryValues({ path: '/x', values: 'single' })).toEqual(['single']);
    expect(pathScopedEntryValues({ path: '/x', values: [1, 'ok'] })).toEqual(['ok']);
    expect(pathScopedEntryValues('bare')).toEqual([]);
  });
});

describe('pluginCliError', () => {
  test('prefers stderr, strips the leading status glyph, keeps the last line', () => {
    expect(pluginCliError({ ok: false, stdout: '', stderr: '\n✗ Failed to install x\n' })).toBe('Failed to install x');
    expect(pluginCliError({ ok: false, stdout: 'stdout note', stderr: '● boom\n○ last line\n' })).toBe('last line');
  });

  test('falls back to stdout and then to a generic message', () => {
    expect(pluginCliError({ ok: false, stdout: 'only stdout', stderr: '' })).toBe('only stdout');
    expect(pluginCliError({ ok: false, stdout: '', stderr: '' })).toBe('omp plugin command failed');
    expect(pluginCliError({ ok: false, stdout: '✗ ', stderr: '' })).toBe('omp plugin command failed');
  });

  test('a scoped package name keeps its leading @ and /', () => {
    expect(pluginCliError({ ok: false, stdout: '', stderr: '@scope/pkg not found' })).toBe('@scope/pkg not found');
  });
});

describe('config-cli in mock mode', () => {
  test('reads answer empty/undefined and writes refuse', async () => {
    Bun.env.MOCK = 'true';
    expect(await listOmpConfig()).toEqual({});
    expect(await getOmpConfigValue('anything')).toBeUndefined();
    await expect(setOmpConfigValue('k', 1)).rejects.toThrow('config writes are unavailable in mock mode');
    await expect(resetOmpConfigKey('k')).rejects.toThrow('config writes are unavailable in mock mode');
  });
});
