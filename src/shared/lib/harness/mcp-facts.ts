/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How each harness receives MCP servers, MEASURED — not assumed.
 *
 * Two deliveries exist, and the difference is a property of the transport, not
 * a preference:
 *
 *  - `acp` — the agent accepts `mcpServers` on `session/new|load|resume|fork`.
 *    This is the ACP baseline (stdio) plus the agent's advertised
 *    `mcpCapabilities` for `http`/`sse`, so one injection covers every ACP
 *    harness without writing a file in the agent's own format.
 *  - `omp-config` — omp's RPC mode reads `~/.omp/agent/mcp.json` (and the
 *    project's `.omp/mcp.json`) at SPAWN. Kabmo writes that file through the MCP
 *    settings page; a change therefore needs a respawn, which is why the
 *    delivery is a file rather than a per-session argument.
 *
 * A harness added later is a row here, not a new branch in the spawn path. The
 * table is deliberately exhaustive over `HarnessId`: a missing row is a compile
 * error, so a new agent cannot silently receive no MCP servers.
 */

import type { BuiltinHarnessId, HarnessId } from '@/shared/lib/harness/catalog';

export type McpDelivery = 'acp' | 'omp-config';

export interface HarnessMcpFacts {
  delivery: McpDelivery;
  /** Why this delivery, in one line a settings card can show. */
  note: string;
}

export const HARNESS_MCP_FACTS: Record<BuiltinHarnessId, HarnessMcpFacts> = {
  'omp-rpc': {
    delivery: 'omp-config',
    note: 'omp reads ~/.omp/agent/mcp.json at spawn; a change applies to the next session.',
  },
  'omp-acp': { delivery: 'acp', note: 'Injected on session/new, so every new chat sees the current list.' },
  claude: { delivery: 'acp', note: 'Injected on session/new, so every new chat sees the current list.' },
  codex: { delivery: 'acp', note: 'Injected on session/new, so every new chat sees the current list.' },
  opencode: { delivery: 'acp', note: 'Injected on session/new, so every new chat sees the current list.' },
  'command-code': { delivery: 'acp', note: 'Injected on session/new, so every new chat sees the current list.' },
  dsh: { delivery: 'acp', note: 'Injected on session/new, so every new chat sees the current list.' },
  antigravity: { delivery: 'acp', note: 'Injected on session/new, so every new chat sees the current list.' },
  minimax: { delivery: 'acp', note: 'Injected on session/new, so every new chat sees the current list.' },
  pi: { delivery: 'acp', note: 'Injected on session/new, so every new chat sees the current list.' },
  qwen: { delivery: 'acp', note: 'Injected on session/new, so every new chat sees the current list.' },
  kimi: { delivery: 'acp', note: 'Injected on session/new, so every new chat sees the current list.' },
  cursor: { delivery: 'acp', note: 'Injected on session/new, so every new chat sees the current list.' },
  zcode: { delivery: 'acp', note: 'Injected on session/new, so every new chat sees the current list.' },
  jcode: { delivery: 'acp', note: 'Injected on session/new, so every new chat sees the current list.' },
  // Measured on 1.0.77: `mcpCapabilities` advertises stdio, http AND sse, and
  // the agent also loads config.toml / ~/.claude.json / .mcp.json on its own.
  grok: { delivery: 'acp', note: 'Injected on session/new and advertised for stdio, http and sse (measured 1.0.77); grok also loads MCP servers from config.toml, ~/.claude.json and the project .mcp.json.' },
};

/**
 * The delivery for one harness.
 *
 * A user-added harness is ACP by definition — that is the only transport the
 * add form offers — so an id with no row takes the ACP path rather than
 * crashing the spawn on an undefined table entry.
 */
export function mcpDelivery(harness: HarnessId): McpDelivery {
  return (HARNESS_MCP_FACTS as Record<string, HarnessMcpFacts | undefined>)[harness]?.delivery ?? 'acp';
}
