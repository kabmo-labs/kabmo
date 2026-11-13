/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The native `mcp.json` mapping and write contract.
 *
 * Pinned because each decides on untrusted or hand-written input:
 * - `nativeToServerItem` maps a native entry to Kabmo shape; a wrong transport
 *   or a dropped field makes the UI edit a server it cannot describe.
 * - `writeUserMcpServer` must preserve credentials the browser redacted, record
 *   enablement in the same place omp reads it, and reject a name outside the
 *   file's key grammar.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  MCP_FILENAMES,
  nativeToServerItem,
  readProjectMcpConfig,
  readUserMcpConfig,
  redactEnvVars,
  resolveProjectMcpConfig,
} from '@/server/lib/omp/config/mcp';
import { deleteUserMcpServer, writeUserMcpServer } from '@/server/lib/omp/config/mcp-write';

const roots: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.promises.mkdtemp(join(tmpdir(), 'omp-mcp-config-'));
  roots.push(dir);
  return dir;
}

afterAll(async () => {
  for (const root of roots) await fs.promises.rm(root, { recursive: true, force: true });
});

describe('nativeToServerItem', () => {
  test('a command server becomes a stdio item with split args', () => {
    const item = nativeToServerItem('fs', { command: 'npx', args: ['-y', '@mcp/fs'] }, 2, true);
    expect(item).toEqual({
      id: 'omp-user-fs',
      name: 'fs',
      scope: 'every-project',
      enabled: true,
      transport: 'stdio',
      commandArgs: ['npx', '-y', '@mcp/fs'],
      linkUrl: undefined,
      envVars: [],
      headers: [],
      status: undefined,
    });
  });

  test('a url server becomes an http item and its env vars are stringified', () => {
    const item = nativeToServerItem('web', { url: 'https://mcp.example/sse', env: { A: 1, B: 'two' } }, 0, false);
    expect(item.transport).toBe('http');
    expect(item.linkUrl).toBe('https://mcp.example/sse');
    expect(item.commandArgs).toEqual(['https://mcp.example/sse']);
    expect(item.envVars).toEqual([
      { id: 'env-0-0', key: 'A', value: '1' },
      { id: 'env-0-1', key: 'B', value: 'two' },
    ]);
  });

  test('every schema field survives the mapping', () => {
    const item = nativeToServerItem(
      'legacy',
      {
        type: 'sse',
        url: 'https://x/sse',
        headers: { Authorization: 'Bearer x' },
        timeout: 5000,
        requestIdFormat: 'string',
        instructions: false,
        auth: { type: 'oauth', credentialId: 'c1' },
        oauth: { scope: 'read' },
      },
      0,
      true,
    );
    expect(item.transport).toBe('sse');
    expect(item.headers).toEqual([{ id: 'header-0-0', key: 'Authorization', value: 'Bearer x' }]);
    expect(item.timeout).toBe(5000);
    expect(item.requestIdFormat).toBe('string');
    expect(item.instructions).toBe(false);
    expect(item.auth).toEqual({ type: 'oauth', credentialId: 'c1' });
    expect(item.oauth).toEqual({ scope: 'read' });
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
    expect(await readUserMcpConfig(path)).toEqual({ path, servers: [], disabledServers: [], enabledServers: [] });
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

  test('both project candidates are read, first name wins', async () => {
    const dir = await tempDir();
    await fs.promises.mkdir(join(dir, '.omp'), { recursive: true });
    await Bun.write(join(dir, '.omp', 'mcp.json'), '{"mcpServers":{"shared":{"command":"primary"}}}');
    await Bun.write(join(dir, '.omp', '.mcp.json'), '{"mcpServers":{"shared":{"command":"secondary"},"extra":{"command":"y"}}}');

    const config = await readProjectMcpConfig(dir);
    expect(config.servers.map((s) => s.name)).toEqual(['extra', 'shared']);
    expect(config.servers.find((s) => s.name === 'shared')?.config.command).toBe('primary');
  });

  test('the user-scope dot-file is read alongside mcp.json', async () => {
    const dir = await tempDir();
    await Bun.write(join(dir, 'mcp.json'), '{"mcpServers":{"main":{"command":"a"}}}');
    await Bun.write(join(dir, '.mcp.json'), '{"mcpServers":{"dot":{"url":"https://dot"}}}');

    const config = await readUserMcpConfig(join(dir, 'mcp.json'));
    expect(config.servers.map((s) => s.name)).toEqual(['dot', 'main']);
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

  test('a credential block merges per field instead of erasing the secret', async () => {
    const path = join(await tempDir(), 'mcp.json');
    await Bun.write(path, JSON.stringify({
      mcpServers: { srv: { type: 'http', url: 'https://x', oauth: { clientId: 'id', clientSecret: 'shh' } } },
    }));
    await writeUserMcpServer('srv', { type: 'http', url: 'https://x', oauth: { scope: 'read' } }, path);

    const raw = JSON.parse(await fs.promises.readFile(path, 'utf8'));
    expect(raw.mcpServers.srv.oauth).toEqual({ clientId: 'id', clientSecret: 'shh', scope: 'read' });
  });

  test('a disabled write records enabled:false AND the user denylist', async () => {
    const path = join(await tempDir(), 'mcp.json');
    await writeUserMcpServer('srv', { command: 'x', enabled: false }, path);

    const raw = JSON.parse(await fs.promises.readFile(path, 'utf8'));
    expect(raw.mcpServers.srv).toEqual({ command: 'x', enabled: false });
    expect(raw.disabledServers).toEqual(['srv']);

    // Re-enabling clears both, so the checkbox cannot flip back on reload.
    await writeUserMcpServer('srv', { command: 'x' }, path);
    const after = JSON.parse(await fs.promises.readFile(path, 'utf8'));
    expect(after.mcpServers.srv).toEqual({ command: 'x' });
    expect(after.disabledServers).toBeUndefined();
  });

  test('a remote entry keeps type/url/headers', async () => {
    const path = join(await tempDir(), 'mcp.json');
    await writeUserMcpServer(
      'remote',
      { type: 'sse', url: 'https://x/sse', headers: { Authorization: 'Bearer t' }, timeout: 1000 },
      path,
    );
    const raw = JSON.parse(await fs.promises.readFile(path, 'utf8'));
    expect(raw.mcpServers.remote).toEqual({
      type: 'sse',
      url: 'https://x/sse',
      headers: { Authorization: 'Bearer t' },
      timeout: 1000,
    });
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
