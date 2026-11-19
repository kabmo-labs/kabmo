/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The servers an ACP agent loads from its own config.
 *
 * The navbar used to show only Kabmo's injected list, which is why an ACP chat
 * looked identical to an omp-rpc one. These cases pin the three measured
 * shapes (opencode's `mcp`, Claude's `mcpServers`, Codex's `[mcp_servers]`) and
 * the rule that a harness with no measured file contributes nothing.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { removeDir } from '@/test-support/remove-dir';
import { agentMcpEntriesFor } from '@/server/lib/mcp/agent-config.server';

const ROOT = path.join(os.tmpdir(), `kabmo-agent-mcp-${process.pid}`);
const XDG = path.join(ROOT, 'xdg');
const PROJECT = path.join(ROOT, 'project');
const previousXdg = Bun.env.XDG_CONFIG_HOME;

beforeAll(() => {
  removeDir(ROOT);
  fs.mkdirSync(path.join(XDG, 'opencode'), { recursive: true });
  fs.mkdirSync(path.join(PROJECT, '.codex'), { recursive: true });
  Bun.env.XDG_CONFIG_HOME = XDG;
  fs.writeFileSync(
    path.join(XDG, 'opencode', 'opencode.json'),
    JSON.stringify({
      mcp: {
        local: { type: 'local', command: ['codegraph', 'serve', '--mcp'] },
        remote: { type: 'remote', url: 'https://example/mcp', headers: { 'X-Key': 'v' } },
        off: { type: 'local', command: ['nope'], enabled: false },
      },
    }),
  );
  fs.writeFileSync(
    path.join(PROJECT, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        claudeLocal: { command: 'npx', args: ['-y', 'server'] },
        claudeRemote: { type: 'sse', url: 'https://example/sse' },
      },
    }),
  );
  fs.writeFileSync(
    path.join(PROJECT, '.codex', 'config.toml'),
    [
      '[mcp_servers.codexLocal]',
      'command = "npx"',
      'args = ["-y", "server"]',
      '',
      '[mcp_servers.codexRemote]',
      'url = "https://example/mcp"',
      'http_headers = { "X-Key" = "v" }',
      '',
    ].join('\n'),
  );
});

afterAll(() => {
  if (previousXdg === undefined) delete Bun.env.XDG_CONFIG_HOME;
  else Bun.env.XDG_CONFIG_HOME = previousXdg;
  removeDir(ROOT);
});

describe('agentMcpEntriesFor', () => {
  test('reads opencode local/remote entries and keeps a disabled one disabled', async () => {
    const entries = await agentMcpEntriesFor('opencode', PROJECT);
    expect(entries.map((entry) => entry.name)).toEqual(['local', 'remote', 'off']);
    expect(entries.every((entry) => entry.source === 'agent')).toBe(true);
    expect(entries.find((entry) => entry.name === 'local')?.transport).toBe('stdio');
    expect(entries.find((entry) => entry.name === 'remote')?.transport).toBe('http');
    expect(entries.find((entry) => entry.name === 'off')?.enabled).toBe(false);
    expect(entries.find((entry) => entry.name === 'remote')?.config).toEqual({
      type: 'http',
      url: 'https://example/mcp',
      headers: { 'X-Key': 'v' },
    });
  });

  test('reads Claude project .mcp.json in the native shape', async () => {
    const entries = await agentMcpEntriesFor('claude', PROJECT);
    expect(entries.map((entry) => entry.name)).toEqual(['claudeLocal', 'claudeRemote']);
    expect(entries.find((entry) => entry.name === 'claudeLocal')?.config).toEqual({
      command: 'npx',
      args: ['-y', 'server'],
    });
    expect(entries.find((entry) => entry.name === 'claudeRemote')?.transport).toBe('sse');
  });

  test('reads Codex [mcp_servers] from TOML', async () => {
    const entries = await agentMcpEntriesFor('codex', PROJECT);
    expect(entries.map((entry) => entry.name)).toEqual(['codexLocal', 'codexRemote']);
    expect(entries.find((entry) => entry.name === 'codexLocal')?.transport).toBe('stdio');
    expect(entries.find((entry) => entry.name === 'codexRemote')?.config).toEqual({
      type: 'http',
      url: 'https://example/mcp',
      headers: { 'X-Key': 'v' },
    });
  });

  test('a harness with no measured file contributes nothing', async () => {
    expect(await agentMcpEntriesFor('dsh', PROJECT)).toEqual([]);
  });
});
