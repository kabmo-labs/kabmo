/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MCP server an agent talks to.
 *
 * It is the SAME bundle as the plugin's server half: `server.js --mcp` runs this
 * module's `runMcpServer` instead of registering a plugin. That is deliberate —
 * one build, one copy of the store rules, and no second package to publish.
 *
 * Transport is stdio with newline-delimited JSON-RPC 2.0, which is what every
 * MCP client speaks for a local server. The three methods that matter are
 * `initialize`, `tools/list` and `tools/call`; anything else answers a protocol
 * error rather than silence, because a client that gets no reply waits.
 *
 * The board's data directory arrives in the environment (`KANBAN_DATA_DIR`), not
 * as an argument: a plugin MCP registration has no `cwd` field, and a child that
 * guessed from the agent's directory would read a different board than the panel.
 *
 * The tool table itself is `mcp-tools.ts`; this file owns framing and refusals.
 */

import { KanbanError } from './store/fs';
import { TOOLS, toolNamed } from './mcp-tools';

/** A JSON-RPC reply frame. */
export interface JsonRpcReply {
  jsonrpc: '2.0';
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Handle one JSON-RPC frame. Exported so a test can drive the protocol without
 * spawning a process.
 */
export async function handleRpcFrame(dataDir: string, frame: unknown): Promise<JsonRpcReply | null> {
  const request = (frame ?? {}) as Record<string, unknown>;
  const id = request.id ?? null;
  const method = typeof request.method === 'string' ? request.method : '';
  // A NOTIFICATION (no id) never gets a reply — that is the protocol, not a bug.
  const isNotification = request.id === undefined;

  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'kanban', version: '1.0.0' },
        },
      };
    }
    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        },
      };
    }
    if (method === 'tools/call') {
      const params = (request.params ?? {}) as Record<string, unknown>;
      const name = typeof params.name === 'string' ? params.name : '';
      const tool = toolNamed(name);
      if (!tool) {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool "${name}".` } };
      }
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        const value = await tool.run(dataDir, args);
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError: false },
        };
      } catch (cause) {
        // A refusal is a RESULT the agent can read and act on, not a transport
        // error: it must see "stage does not exist", not "the server broke".
        const error = cause instanceof KanbanError ? cause : null;
        const message = cause instanceof Error ? cause.message : String(cause);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify({ ok: false, code: error?.code ?? 'io', message }) }],
            isError: true,
          },
        };
      }
    }
    if (method === 'notifications/initialized' || method === 'initialized') return null;
    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    return isNotification ? null : { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method "${method}".` } };
  } catch (cause) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: cause instanceof Error ? cause.message : String(cause) },
    };
  }
}

/**
 * Serve stdio until the client closes it.
 *
 * Newline-delimited frames, because that is the framing every stdio MCP client
 * uses; a partial line is buffered rather than dropped.
 */
export async function runMcpServer(dataDir: string): Promise<void> {
  let buffer = '';
  const write = (reply: JsonRpcReply | null) => {
    if (!reply) return;
    process.stdout.write(`${JSON.stringify(reply)}\n`);
  };
  const { promise, resolve } = Promise.withResolvers<void>();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let frame: unknown;
      try {
        frame = JSON.parse(trimmed);
      } catch {
        write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } });
        continue;
      }
      void handleRpcFrame(dataDir, frame).then(write);
    }
  });
  process.stdin.on('end', resolve);
  process.stdin.on('close', resolve);
  await promise;
}
