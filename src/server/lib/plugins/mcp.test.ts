/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A plugin's MCP contribution.
 *
 * The contract: a declaration is validated at load (a server that cannot start
 * is refused by name, not silently skipped), names are namespaced by plugin id,
 * and disposal drops the list so a disabled plugin contributes nothing.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { clearPluginMcp, createPluginMcp, pluginMcpServers } from '@/server/lib/plugins/mcp.server';

afterEach(() => {
  clearPluginMcp('alpha');
  clearPluginMcp('beta');
});

describe('plugin MCP registry', () => {
  test('a stdio server is registered under the plugin namespace', () => {
    createPluginMcp('alpha').register({ id: 'notes', transport: 'stdio', command: 'npx', args: ['-y', 'notes'] });
    expect(pluginMcpServers()).toEqual([
      {
        pluginId: 'alpha',
        name: 'alpha:notes',
        server: { id: 'notes', transport: 'stdio', command: 'npx', args: ['-y', 'notes'] },
      },
    ]);
  });

  test('an explicit name is kept', () => {
    createPluginMcp('alpha').register({ id: 'notes', name: 'Notes', transport: 'http', url: 'https://x' });
    expect(pluginMcpServers()[0]?.name).toBe('Notes');
  });

  test('two plugins may use the same id', () => {
    createPluginMcp('alpha').register({ id: 'notes', transport: 'stdio', command: 'a' });
    createPluginMcp('beta').register({ id: 'notes', transport: 'stdio', command: 'b' });
    expect(pluginMcpServers().map((entry) => entry.name)).toEqual(['alpha:notes', 'beta:notes']);
  });

  test('a duplicate id within one plugin is refused', () => {
    const api = createPluginMcp('alpha');
    api.register({ id: 'notes', transport: 'stdio', command: 'a' });
    expect(() => api.register({ id: 'notes', transport: 'stdio', command: 'b' })).toThrow('already registered');
  });

  test('a stdio server without a command is refused by name', () => {
    expect(() => createPluginMcp('alpha').register({ id: 'broken', transport: 'stdio' })).toThrow('needs a command');
  });

  test('an http server without a url is refused by name', () => {
    expect(() => createPluginMcp('alpha').register({ id: 'broken', transport: 'http' })).toThrow('needs a url');
  });

  test('a non-string env map is refused', () => {
    expect(() =>
      createPluginMcp('alpha').register({
        id: 'broken',
        transport: 'stdio',
        command: 'x',
        env: { PORT: 1 } as unknown as Record<string, string>,
      }),
    ).toThrow('env must be a string map');
  });

  test('disposal drops every server the plugin contributed', () => {
    createPluginMcp('alpha').register({ id: 'notes', transport: 'stdio', command: 'a' });
    clearPluginMcp('alpha');
    expect(pluginMcpServers()).toEqual([]);
  });
});
