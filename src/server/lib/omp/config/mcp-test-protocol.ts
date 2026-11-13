/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MCP handshake's own vocabulary: the initialize frame, the protocol
 * version this client speaks, and the readers for both reply shapes (a plain
 * JSON body and an SSE frame).
 *
 * Shared so the stdio and remote probes cannot drift into asking different
 * questions or reading different answers.
 */

import { isRecord } from '@/shared/lib/util/guards';
import type { McpTransport } from '@/shared/types';

export const PROTOCOL_VERSION = '2025-06-18';
export const CLIENT_INFO = { name: 'kabmo', version: '0.0.1' };

/** The answer the settings pane renders for one connection test. */
export interface McpTestResult {
  ok: boolean;
  transport: McpTransport;
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
  toolCount?: number;
  durationMs: number;
  error?: string;
}

export interface HandshakeOutcome {
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
  toolCount?: number;
}

export function parseServerInfo(value: unknown): { name?: string; version?: string } | undefined {
  if (!isRecord(value)) return undefined;
  const info: { name?: string; version?: string } = {};
  if (typeof value.name === 'string') info.name = value.name;
  if (typeof value.version === 'string') info.version = value.version;
  return info.name !== undefined || info.version !== undefined ? info : undefined;
}

export function describeError(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (isRecord(value) && typeof value.message === 'string') return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return 'Unknown error';
  }
}

export function initializeRequest(): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
  };
}

/** The `initialize` result, whether the server wrapped it in a JSON-RPC envelope or not. */
export function extractInitializeOutcome(payload: unknown): HandshakeOutcome {
  const result = isRecord(payload) && isRecord(payload.result) ? payload.result : payload;
  if (!isRecord(result)) return {};
  return {
    protocolVersion: typeof result.protocolVersion === 'string' ? result.protocolVersion : undefined,
    serverInfo: parseServerInfo(result.serverInfo),
  };
}

/** The first parseable `data:` line of an SSE body. */
export function extractSseData(text: string): unknown {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      return JSON.parse(data);
    } catch {
      // skip malformed frames; keep scanning for the first parseable data line
    }
  }
  return undefined;
}
