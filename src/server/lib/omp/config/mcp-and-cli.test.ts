/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MCP test-connection decision, the path-scoped setting resolver, and the
 * two CLI bridges' pure parts.
 *
 * Pinned because each decides on untrusted or hand-written input:
 * - `testMcpServer` classifies an unusable configuration WITHOUT spawning
 *   anything, so the route answers with a useful error rather than a 500.
 * - `resolvePathScopedSlugs` must not flatten per-project policy: an object
 *   entry applies only when its prefix contains the cwd.
 * - `pluginCliError` is the sentence the settings pane shows for a refused CLI.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { testMcpServer } from '@/server/lib/omp/config/mcp-test';
import { isPathScopedEntry, pathScopedEntryValues, resolvePathScopedSlugs } from '@/server/lib/omp/config/path-scoped';
import { pluginCliError } from '@/server/lib/omp/config/plugin-cli';
import { getOmpConfigValue, listOmpConfig, resetOmpConfigKey, setOmpConfigValue } from '@/server/lib/omp/config/config-cli';

const originalMock = Bun.env.MOCK;

afterAll(() => {
  if (originalMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = originalMock;
});

beforeEach(() => {
  // The default suite runs with real data; the mock branches are opted into
  // explicitly per test.
  Bun.env.MOCK = 'false';
});

describe('testMcpServer decision logic (no spawn, no network)', () => {
  test('a link URL that is not http(s) is rejected without a request', async () => {
    const result = await testMcpServer({
      server: { id: '1', name: 'x', scope: 'every-project', enabled: true, transport: 'http', commandArgs: [], linkUrl: 'ftp://x', envVars: [], headers: [] },
    });
    expect(result).toEqual({
      ok: false,
      transport: 'http',
      durationMs: 0,
      error: 'Link URL must be a valid http(s) endpoint',
    });
  });

  test('a command server with no arguments is rejected without spawning', async () => {
    const result = await testMcpServer({
      server: { id: '1', name: 'x', scope: 'every-project', enabled: true, transport: 'stdio', commandArgs: ['  '], envVars: [], headers: [] },
    });
    expect(result.ok).toBe(false);
    expect(result.transport).toBe('stdio');
    expect(result.error).toBe('No command configured');
  });

  test('mock mode validates the configuration instead of connecting', async () => {
    Bun.env.MOCK = '1';
    const bad = await testMcpServer({
      server: { id: '1', name: 'x', scope: 'every-project', enabled: true, transport: 'http', commandArgs: [], linkUrl: 'nope', envVars: [], headers: [] },
    });
    expect(bad).toEqual({ ok: false, transport: 'http', durationMs: 12, error: 'Invalid server configuration' });

    const good = await testMcpServer({
      server: { id: '2', name: 'web', scope: 'every-project', enabled: true, transport: 'sse', commandArgs: [], linkUrl: 'https://mcp.example', envVars: [], headers: [] },
    });
    expect(good).toEqual({
      ok: true,
      transport: 'sse',
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
