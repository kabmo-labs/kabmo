/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A real connection probe for one session's MCP server, cached briefly.
 *
 * omp publishes no MCP state over RPC: `mcp:connection-status` is an internal
 * TUI event bus, `/mcp list` over RPC prints the configured state, and
 * `get_state.dumpTools` carries only the built-in tools (measured on 18.20.0 —
 * a live codegraph server mounted no `mcp__` entry there). The one honest
 * signal is a handshake, which Kabmo already implements for the settings pane
 * (`testMcpServer`): spawn the configured command (or POST the endpoint), run
 * `initialize` → `tools/list`, and report what came back.
 *
 * The probe is ON DEMAND — the navbar's info control — because it starts a
 * second instance of the server. Results are cached per session+server for a
 * minute so reopening the popover does not spawn it again.
 */

import { nativeToServerItem } from '@/server/lib/omp/config/mcp';
import { testMcpServer } from '@/server/lib/omp/config/mcp-test';
import type { McpServerEntry } from '@/server/lib/mcp/registry.server';
import type { McpProbeResult } from '@/shared/types';

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, McpProbeResult>();

function cacheKey(sessionId: string, name: string): string {
  return `${sessionId}\u0000${name}`;
}

/** The cached answer for this session+server, or undefined when stale/absent. */
export function cachedMcpProbe(sessionId: string, name: string): McpProbeResult | undefined {
  const key = cacheKey(sessionId, name);
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.checkedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit;
}

/** Run a real handshake and cache the answer. */
export async function probeMcpServer(
  sessionId: string,
  entry: McpServerEntry,
  cwd: string,
): Promise<McpProbeResult> {
  const item = nativeToServerItem(entry.name, entry.config, 0, true);
  // A spawn failure (ENOENT, a refused endpoint) is a RESULT, not a 500: the
  // status icon has to say "failed" with the reason.
  const result = await testMcpServer({ server: item, cwd }).catch((cause: unknown) => ({
    ok: false,
    transport: item.transport,
    toolCount: 0,
    durationMs: 0,
    error: cause instanceof Error ? cause.message : String(cause),
  }));
  const probe: McpProbeResult = {
    ok: result.ok,
    ...(result.error ? { error: result.error } : {}),
    toolCount: result.toolCount ?? 0,
    durationMs: result.durationMs,
    checkedAt: Date.now(),
  };
  cache.set(cacheKey(sessionId, entry.name), probe);
  return probe;
}
