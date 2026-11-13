/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Native OMP MCP config access — faithful adaptation of omp-web/lib/omp/mcp-config.ts.
 *
 * The file is omp's own `mcp.json` (user: `~/.omp/agent/mcp.json`, project:
 * `.omp/mcp.json` and its candidates). Every field the schema defines is
 * carried through: transport (`type`), `command`/`args`/`env`/`cwd` for stdio,
 * `url`/`headers` for http and sse, plus `timeout`, `requestIdFormat`,
 * `instructions`, `auth` and `oauth`.
 *
 * Enablement is omp's own model, not a Kabmo invention:
 *  - `disabledServers` (user file) is the highest-precedence denylist;
 *  - `enabledServers` (user file) overrides a source's `enabled: false`;
 *  - a server entry's own `enabled: false` disables it.
 * The writer (`mcp-write.ts`) records all three; this module only reads them.
 */

import { dirname, join, resolve } from 'path';
import { pathExists } from '@/server/lib/omp/core/paths';
import { getOmpConfigPath } from '@/server/lib/omp/config/yaml';
import type { McpAuthConfig, McpOAuthConfig, McpServerItem, McpTransport } from '@/shared/types';
import { isRecord } from '@/shared/lib/util/guards';
import { REDACTED_SENTINEL, recordToRows } from '@/shared/lib/mcp/key-value';
import { MAX_MCP_CONFIG_BYTES, stringsIn, userMcpConfigPath, type McpFile, type McpServer } from '@/server/lib/omp/config/mcp-shared';

/** Project-level config candidates, in omp preference order. */
export const MCP_FILENAMES = [join('.omp', 'mcp.json'), join('.omp', '.mcp.json'), 'mcp.json', '.mcp.json'];

export interface McpUserConfig {
  path: string;
  servers: Array<{ name: string; config: McpServer }>;
  disabledServers: string[];
  enabledServers: string[];
  error?: string;
}

function serverEntries(config: McpFile): Array<{ name: string; config: McpServer }> {
  return Object.entries(config.mcpServers ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, server]) => ({ name, config: server }));
}

async function readMcpFile(path: string): Promise<McpUserConfig> {
  if (!(await Bun.file(path).exists())) {
    return { path, servers: [], disabledServers: [], enabledServers: [] };
  }
  try {
    const file = Bun.file(path);
    if ((await file.stat()).size > MAX_MCP_CONFIG_BYTES) throw new Error('configuration is too large to inspect');
    const parsed: unknown = JSON.parse(await file.text());
    if (!isRecord(parsed)) throw new Error('configuration must contain a JSON object');
    if (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers)) throw new Error('mcpServers must be an object');
    return {
      path,
      servers: serverEntries(parsed as McpFile),
      disabledServers: stringsIn(parsed.disabledServers),
      enabledServers: stringsIn(parsed.enabledServers),
    };
  } catch (error) {
    return {
      path,
      servers: [],
      disabledServers: [],
      enabledServers: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Read the user scope. omp discovers BOTH `~/.omp/agent/mcp.json` and
 * `~/.omp/agent/.mcp.json`, so a server declared only in the dot-file is live
 * for a session and must be visible here too; `mcp.json` wins on a name clash,
 * and the two enablement lists are unioned. A malformed file is reported on the
 * result rather than hiding the other file's servers.
 */
export async function readUserMcpConfig(path = userMcpConfigPath()): Promise<McpUserConfig> {
  const primary = await readMcpFile(path);
  const secondaryPath = join(dirname(path), '.mcp.json');
  if (secondaryPath === path || !(await Bun.file(secondaryPath).exists())) return primary;
  const secondary = await readMcpFile(secondaryPath);
  const names = new Set(primary.servers.map((entry) => entry.name));
  return {
    path,
    servers: [...primary.servers, ...secondary.servers.filter((entry) => !names.has(entry.name))].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    disabledServers: [...new Set([...primary.disabledServers, ...secondary.disabledServers])],
    enabledServers: [...new Set([...primary.enabledServers, ...secondary.enabledServers])],
    ...(primary.error ?? secondary.error ? { error: primary.error ?? secondary.error } : {}),
  };
}

/** Resolve a project's config file: first existing candidate, else `.omp/mcp.json`.
 *  Probes through `pathExists`, not `Bun.file(p).exists()` — a candidate can
 *  exist as a directory, which the latter reports false for. */
export async function resolveProjectMcpConfig(projectRoot: string): Promise<{ root: string; path: string }> {
  const root = resolve(projectRoot);
  for (const filename of MCP_FILENAMES) {
    const candidate = join(root, filename);
    if (await pathExists(candidate)) return { root, path: candidate };
  }
  return { root, path: join(root, MCP_FILENAMES[0]) };
}

/**
 * Read the project scope as omp does: every candidate that exists, in
 * preference order, first name wins. `resolveProjectMcpConfig` stays the WRITE
 * target (the first existing candidate), because a write has to pick one file.
 */
export async function readProjectMcpConfig(projectRoot: string): Promise<McpUserConfig> {
  const { root, path } = await resolveProjectMcpConfig(projectRoot);
  const merged = await readMcpFile(path);
  const names = new Set(merged.servers.map((entry) => entry.name));
  for (const filename of MCP_FILENAMES.slice(1)) {
    const candidate = join(root, filename);
    if (candidate === path || !(await pathExists(candidate))) continue;
    const extra = await readMcpFile(candidate);
    for (const entry of extra.servers) {
      if (names.has(entry.name)) continue;
      names.add(entry.name);
      merged.servers.push(entry);
    }
    merged.disabledServers.push(...extra.disabledServers);
    merged.enabledServers.push(...extra.enabledServers);
    if (!merged.error && extra.error) merged.error = extra.error;
  }
  merged.servers.sort((a, b) => a.name.localeCompare(b.name));
  return merged;
}

/**
 * omp's `mcp.enableProjectConfig` (default true) — the switch that decides
 * whether a project's `mcp.json` is discovered at all. Read from
 * `~/.omp/agent/config.yml`; an unreadable file keeps the default rather than
 * silently dropping every project server.
 */
export async function isProjectMcpConfigEnabled(): Promise<boolean> {
  try {
    const file = Bun.file(getOmpConfigPath());
    if (!(await file.exists())) return true;
    const parsed: unknown = Bun.YAML.parse(await file.text());
    if (!isRecord(parsed) || !isRecord(parsed.mcp)) return true;
    return parsed.mcp.enableProjectConfig !== false;
  } catch {
    return true;
  }
}

/** omp's enablement precedence: denylist, then the entry's own flag, then the allowlist. */
export function isServerEnabled(
  name: string,
  config: McpServer,
  disabledServers: readonly string[],
  enabledServers: readonly string[],
): boolean {
  if (disabledServers.includes(name)) return false;
  if (config.enabled === false) return enabledServers.includes(name);
  return true;
}

/** Convert a native omp server config into Kabmo McpServerItem shape.
 *  Pass `project` to produce a project-scoped item (id omp-project-<name>). */
export function nativeToServerItem(
  name: string,
  config: McpServer,
  index: number,
  enabled: boolean,
  project?: { path: string },
): McpServerItem {
  const transport: McpTransport = config.type === 'sse'
    ? 'sse'
    : typeof config.url === 'string'
      ? 'http'
      : 'stdio';
  const isLink = transport !== 'stdio';
  const args = Array.isArray(config.args) ? config.args.map(String) : [];
  const item: McpServerItem = {
    id: `${project ? 'omp-project' : 'omp-user'}-${name}`,
    name,
    scope: project ? 'this-project' : 'every-project',
    ...(project ? { projectPath: project.path } : {}),
    enabled,
    transport,
    commandArgs: isLink
      ? [String(config.url)]
      : [String(config.command ?? ''), ...args].filter(Boolean),
    linkUrl: isLink ? String(config.url) : undefined,
    envVars: recordToRows(isRecord(config.env) ? config.env : {}, `env-${index}`),
    headers: recordToRows(isRecord(config.headers) ? config.headers : {}, `header-${index}`),
    status: undefined,
  };
  if (typeof config.cwd === 'string') item.cwd = config.cwd;
  if (typeof config.timeout === 'number') item.timeout = config.timeout;
  if (config.requestIdFormat === 'string' || config.requestIdFormat === 'number') {
    item.requestIdFormat = config.requestIdFormat;
  }
  if (typeof config.instructions === 'boolean') item.instructions = config.instructions;
  if (isRecord(config.auth)) item.auth = config.auth as unknown as McpAuthConfig;
  if (isRecord(config.oauth)) item.oauth = config.oauth as unknown as McpOAuthConfig;
  return item;
}

const SENSITIVE_KEY = /(key|token|secret|password|credential|auth|cookie)/i;

/** Redact env var values for display — the browser never sees raw credentials. */
export function redactEnvVars<T extends { key: string; value: string }>(envVars: T[]): T[] {
  return envVars.map((item) => (SENSITIVE_KEY.test(item.key) ? { ...item, value: REDACTED_SENTINEL } : item));
}

/** Redact every credential-bearing field of a server row before it leaves the server. */
export function redactServerItem(item: McpServerItem): McpServerItem {
  const redacted: McpServerItem = {
    ...item,
    envVars: redactEnvVars(item.envVars ?? []),
    headers: redactEnvVars(item.headers ?? []),
  };
  if (item.auth?.clientSecret) redacted.auth = { ...item.auth, clientSecret: REDACTED_SENTINEL };
  if (item.oauth?.clientSecret) redacted.oauth = { ...item.oauth, clientSecret: REDACTED_SENTINEL };
  return redacted;
}
