/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Import + normalizer contracts.
 *
 * The import parser decides what a pasted snippet becomes, and every other tool
 * writes a different envelope: keeping only the first server, or dropping a
 * remote entry's `type`, is the difference between a working import and one the
 * user has to repair by hand. The normalizer is the read boundary for rows
 * written before `transport` existed.
 */

import { describe, expect, test } from 'bun:test';
import { parseMcpImport } from '@/shared/lib/mcp/import';
import { normalizeMcpItem } from '@/shared/lib/mcp/item';
import { recordToRows, rowsToRecord } from '@/shared/lib/mcp/key-value';

describe('parseMcpImport', () => {
  test('every server in an mcpServers block is imported', () => {
    const servers = parseMcpImport(JSON.stringify({
      mcpServers: {
        one: { command: 'a', args: ['x'] },
        two: { command: 'b' },
      },
    }));
    expect(servers.map((server) => server.name)).toEqual(['one', 'two']);
    expect(servers[0]).toMatchObject({ transport: 'stdio', commandArgs: ['a', 'x'] });
  });

  test('VS Code `.vscode/mcp.json` (`servers`, typed transports) is understood', () => {
    const servers = parseMcpImport(JSON.stringify({
      servers: {
        local: { type: 'stdio', command: 'npx', args: ['-y', 'x'], env: { K: 'V' } },
        remote: { type: 'http', url: 'https://x/mcp', headers: { Authorization: 'Bearer t' } },
        legacy: { type: 'sse', url: 'https://y/sse' },
      },
    }));
    expect(servers.map((server) => server.transport)).toEqual(['stdio', 'http', 'sse']);
    expect(servers[1]).toMatchObject({
      linkUrl: 'https://x/mcp',
      headers: [{ id: 'header-1-0', key: 'Authorization', value: 'Bearer t' }],
    });
  });

  test('OpenCode (`mcp`, `type: local|remote`, command array, environment) is understood', () => {
    const servers = parseMcpImport(JSON.stringify({
      mcp: {
        local: { type: 'local', command: ['bunx', 'server'], environment: { TOKEN: 't' } },
        remote: { type: 'remote', url: 'https://z/mcp' },
      },
    }));
    expect(servers[0]).toMatchObject({
      transport: 'stdio',
      commandArgs: ['bunx', 'server'],
      envVars: [{ id: 'env-0-0', key: 'TOKEN', value: 't' }],
    });
    expect(servers[1]).toMatchObject({ transport: 'http', linkUrl: 'https://z/mcp' });
  });

  test('Gemini `httpUrl` is read as a remote URL', () => {
    const servers = parseMcpImport(JSON.stringify({
      mcpServers: { g: { httpUrl: 'https://gemini/mcp' } },
    }));
    expect(servers[0]).toMatchObject({ transport: 'http', linkUrl: 'https://gemini/mcp' });
  });

  test('a bare definition is one server; a blank envelope and bad JSON are errors', () => {
    expect(parseMcpImport(JSON.stringify({ name: 'solo', command: 'x' }))).toHaveLength(1);
    expect(() => parseMcpImport(JSON.stringify({ mcpServers: {} }))).toThrow('No server definitions found');
    expect(() => parseMcpImport('{nope')).toThrow('That is not valid JSON.');
    expect(() => parseMcpImport('[1]')).toThrow('Paste a JSON object');
  });
});

describe('normalizeMcpItem', () => {
  test('a legacy reachType row becomes an explicit transport with empty lists', () => {
    expect(normalizeMcpItem({ id: 'a', name: 'a', scope: 'every-project', reachType: 'link', linkUrl: 'https://x' }))
      .toMatchObject({ transport: 'http', enabled: true, headers: [], envVars: [], commandArgs: [] });
    expect(normalizeMcpItem({ id: 'b', name: 'b', reachType: 'command' })).toMatchObject({ transport: 'stdio' });
  });

  test('a malformed row is dropped rather than guessed at', () => {
    expect(normalizeMcpItem({ name: 'x' })).toBeNull();
    expect(normalizeMcpItem({ id: 'x' })).toBeNull();
    expect(normalizeMcpItem(null)).toBeNull();
  });

  test('credential blocks and schema fields survive normalization', () => {
    expect(normalizeMcpItem({
      id: 'c',
      name: 'c',
      transport: 'sse',
      timeout: 10,
      instructions: false,
      auth: { type: 'oauth' },
    })).toMatchObject({ transport: 'sse', timeout: 10, instructions: false, auth: { type: 'oauth' } });
  });
});

describe('key/value rows', () => {
  test('blank keys and the redaction sentinel are never written', () => {
    expect(rowsToRecord([
      { id: '1', key: ' ', value: 'x' },
      { id: '2', key: 'TOKEN', value: '••••••••' },
      { id: '3', key: 'OK', value: 'v' },
    ])).toEqual({ OK: 'v' });
    expect(rowsToRecord([])).toBeUndefined();
  });

  test('a native record becomes rows with stable ids', () => {
    expect(recordToRows({ A: 1, B: 'two' }, 'env-0')).toEqual([
      { id: 'env-0-0', key: 'A', value: '1' },
      { id: 'env-0-1', key: 'B', value: 'two' },
    ]);
  });
});
