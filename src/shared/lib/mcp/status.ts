/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The status shown beside one MCP server, from the only signal Kabmo has: a
 * real handshake (`probe.server.ts`).
 *
 * omp publishes no MCP state over RPC — `mcp:connection-status` is an internal
 * TUI event bus, `/mcp list` over RPC prints the configured state, and
 * `get_state.dumpTools` carries only the built-in tools (measured on 18.20.0:
 * a live codegraph server mounted no `mcp__` entry there). So the status is
 * "did the handshake succeed", never a guess from `enabled`:
 *
 *  - `active`   — the handshake answered and listed tools;
 *  - `error`    — the handshake failed (the reason is in the probe);
 *  - `checking` — a probe is in flight;
 *  - `disabled` — turned off for this session;
 *  - `unknown`  — not probed yet.
 */

export type McpServerStatus = 'active' | 'error' | 'checking' | 'disabled' | 'unknown';

export interface McpProbeLike {
  ok: boolean;
}

export function mcpServerStatus(input: {
  enabled: boolean;
  checking: boolean;
  probe: McpProbeLike | null | undefined;
}): McpServerStatus {
  if (!input.enabled) return 'disabled';
  if (input.checking) return 'checking';
  if (!input.probe) return 'unknown';
  return input.probe.ok ? 'active' : 'error';
}
