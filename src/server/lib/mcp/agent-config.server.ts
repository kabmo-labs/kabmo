/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MCP servers an ACP agent loads from its OWN config.
 *
 * Kabmo's merge (`registry.server.ts`) is the list Kabmo INJECTS on
 * `session/new`. An ACP agent also reads its own config — opencode's
 * `opencode.json`, Claude's `~/.claude.json`, Codex's `config.toml`,
 * Antigravity's `mcp_config.json` — and those servers are invisible to the
 * navbar unless they are read here. The list is the union: injected first,
 * then the agent's own names that the injection did not already cover.
 *
 * Only the formats measured on a real install are listed. A harness with no
 * row has no agent-native list Kabmo can name, and the panel shows the
 * injected list alone rather than guessing at a file.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { transportOf, type McpServerEntry } from '@/server/lib/mcp/registry.server';
import type { McpServer } from '@/server/lib/omp/config/mcp-shared';
import type { HarnessId } from '@kabmo-labs/kabmo-harness-catalog';

type AgentMcpShape = 'native' | 'opencode' | 'codex';

interface AgentMcpSource {
  /** Where the file lives: the user's home, the project, or `$XDG_CONFIG_HOME`. */
  scope: 'home' | 'project' | 'xdg';
  /** Path relative to the scope root. */
  file: string;
  format: 'json' | 'toml';
  /** The key that holds the server map. */
  pointer: string;
  shape: AgentMcpShape;
}

/**
 * The measured config files. `opencode` and `antigravity` were read on this
 * machine; `claude` and `codex` are their vendors' documented MCP locations.
 * `omp-acp` is absent on purpose: its `~/.omp/agent/mcp.json` is already the
 * `user` source of Kabmo's own merge, and a second row would duplicate it.
 */
const AGENT_MCP_SOURCES: Partial<Record<HarnessId, readonly AgentMcpSource[]>> = {
  // opencode deep-merges project over user, and `.opencode/` over the project
  // root; the first entry wins here, so the list names the config the agent
  // actually uses.
  opencode: [
    { scope: 'project', file: '.opencode/opencode.json', format: 'json', pointer: 'mcp', shape: 'opencode' },
    { scope: 'project', file: 'opencode.json', format: 'json', pointer: 'mcp', shape: 'opencode' },
    { scope: 'xdg', file: 'opencode/opencode.json', format: 'json', pointer: 'mcp', shape: 'opencode' },
  ],
  // Claude and Codex both encounter the project entry before the user entry.
  claude: [
    { scope: 'project', file: '.mcp.json', format: 'json', pointer: 'mcpServers', shape: 'native' },
    { scope: 'project', file: '.claude/mcp.json', format: 'json', pointer: 'mcpServers', shape: 'native' },
    { scope: 'home', file: '.claude.json', format: 'json', pointer: 'mcpServers', shape: 'native' },
  ],
  codex: [
    { scope: 'project', file: '.codex/config.toml', format: 'toml', pointer: 'mcp_servers', shape: 'codex' },
    { scope: 'home', file: '.codex/config.toml', format: 'toml', pointer: 'mcp_servers', shape: 'codex' },
  ],
  antigravity: [
    { scope: 'home', file: '.gemini/config/mcp_config.json', format: 'json', pointer: 'mcpServers', shape: 'native' },
  ],
  grok: [
    { scope: 'project', file: '.mcp.json', format: 'json', pointer: 'mcpServers', shape: 'native' },
    { scope: 'home', file: '.claude.json', format: 'json', pointer: 'mcpServers', shape: 'native' },
  ],
};

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** One agent-native entry in omp's `mcp.json` shape, or null when malformed. */
function nativeFromAgentEntry(shape: AgentMcpShape, raw: unknown): McpServer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  if (shape === 'opencode') {
    if (entry.type === 'remote') {
      const url = typeof entry.url === 'string' ? entry.url.trim() : '';
      if (!url) return null;
      const headers = stringRecord(entry.headers);
      return {
        type: 'http',
        url,
        ...(headers ? { headers } : {}),
        ...(entry.enabled === false ? { enabled: false } : {}),
      };
    }
    const command = stringList(entry.command);
    if (command.length === 0) return null;
    const env = stringRecord(entry.environment);
    return {
      command: command[0],
      ...(command.length > 1 ? { args: command.slice(1) } : {}),
      ...(env ? { env } : {}),
      ...(entry.enabled === false ? { enabled: false } : {}),
    };
  }
  if (shape === 'codex') {
    if (typeof entry.url === 'string' && entry.url.trim()) {
      const headers = stringRecord(entry.http_headers);
      return { type: 'http', url: entry.url.trim(), ...(headers ? { headers } : {}) };
    }
    if (typeof entry.command === 'string' && entry.command.trim()) {
      const args = stringList(entry.args);
      const env = stringRecord(entry.env);
      return {
        command: entry.command.trim(),
        ...(args.length > 0 ? { args } : {}),
        ...(env ? { env } : {}),
      };
    }
    return null;
  }
  // `native`: Claude's `mcpServers` and Antigravity's `mcp_config.json`.
  if (typeof entry.url === 'string' && entry.url.trim()) {
    const headers = stringRecord(entry.headers);
    return {
      type: entry.type === 'sse' ? 'sse' : 'http',
      url: entry.url.trim(),
      ...(headers ? { headers } : {}),
      ...(entry.enabled === false ? { enabled: false } : {}),
    };
  }
  if (typeof entry.command === 'string' && entry.command.trim()) {
    const args = stringList(entry.args);
    const env = stringRecord(entry.env);
    return {
      command: entry.command.trim(),
      ...(args.length > 0 ? { args } : {}),
      ...(env ? { env } : {}),
      ...(entry.enabled === false ? { enabled: false } : {}),
    };
  }
  return null;
}

function sourcePath(source: AgentMcpSource, cwd: string): string {
  if (source.scope === 'project') return join(cwd, source.file);
  if (source.scope === 'xdg') {
    const root = Bun.env.XDG_CONFIG_HOME || join(homedir(), '.config');
    return join(root, source.file);
  }
  return join(homedir(), source.file);
}

async function readDocument(path: string, format: 'json' | 'toml'): Promise<Record<string, unknown> | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const text = await file.text();
    const parsed: unknown = format === 'json' ? JSON.parse(text) : parseToml(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // A malformed or unreadable file is not a failed session: the injected
    // list still answers, and the agent's own file is the agent's to fix.
    return null;
  }
}

/**
 * The servers the agent loads from its own config, in the same entry shape the
 * injected list uses. First name wins across the agent's own files, matching
 * the order the agent itself reads them (user before project).
 */
export async function agentMcpEntriesFor(harness: HarnessId, cwd: string): Promise<McpServerEntry[]> {
  const sources = AGENT_MCP_SOURCES[harness];
  if (!sources) return [];
  const entries: McpServerEntry[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const doc = await readDocument(sourcePath(source, cwd), source.format);
    const map = doc?.[source.pointer];
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    for (const [name, raw] of Object.entries(map as Record<string, unknown>)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      const config = nativeFromAgentEntry(source.shape, raw);
      if (!config) continue;
      seen.add(key);
      entries.push({
        name,
        config,
        transport: transportOf(config),
        source: 'agent',
        enabled: config.enabled !== false,
      });
    }
  }
  return entries;
}
