/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Native OMP MCP config access — faithful adaptation of omp-web/lib/omp/mcp-config.ts.
 *
 * Reads and writes the native configs the omp agent actually loads:
 * - user scope:    ~/.omp/agent/mcp.json
 * - project scope: <projectRoot>/.omp/mcp.json (first existing of the
 *   MCP_FILENAMES candidates, else `.omp/mcp.json`)
 *
 * Every read-modify-write runs under a cross-process lockfile so concurrent
 * writers cannot lose each other's mutations. Credentials (env/headers) are
 * never exposed to the browser and are preserved when an edit omits them.
 */

import { join, resolve } from 'path';
import { getAgentDir, pathExists } from '@/server/lib/omp/core/paths';
import { writeFileAtomic } from '@/server/lib/fs/atomic-write';
import { withConfigLock } from '@/server/lib/fs/config-lock';
import { isRecord } from '@/shared/lib/util/guards';

const MAX_MCP_CONFIG_BYTES = 512 * 1024;
const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Project-level config candidates, in omp preference order. */
export const MCP_FILENAMES = [join('.omp', 'mcp.json'), join('.omp', '.mcp.json'), 'mcp.json', '.mcp.json'];

export type McpServer = Record<string, unknown>;
export type McpFile = Record<string, unknown> & { mcpServers?: Record<string, McpServer> };

export interface McpUserConfig {
  path: string;
  servers: Array<{ name: string; config: McpServer }>;
  disabledServers: string[];
  error?: string;
}

function serverEntries(config: McpFile): Array<{ name: string; config: McpServer }> {
  return Object.entries(config.mcpServers ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, server]) => ({ name, config: server }));
}

async function readMcpFile(path: string): Promise<McpUserConfig> {
  if (!(await Bun.file(path).exists())) return { path, servers: [], disabledServers: [] };
  try {
    const file = Bun.file(path);
    if ((await file.stat()).size > MAX_MCP_CONFIG_BYTES) throw new Error('configuration is too large to inspect');
    const parsed: unknown = JSON.parse(await file.text());
    if (!isRecord(parsed)) throw new Error('configuration must contain a JSON object');
    if (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers)) throw new Error('mcpServers must be an object');
    return {
      path,
      servers: serverEntries(parsed as McpFile),
      disabledServers: Array.isArray(parsed.disabledServers)
        ? parsed.disabledServers.filter((name): name is string => typeof name === 'string')
        : [],
    };
  } catch (error) {
    return { path, servers: [], disabledServers: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** Read ~/.omp/agent/mcp.json (user scope) without throwing. */
export async function readUserMcpConfig(path = join(getAgentDir(), 'mcp.json')): Promise<McpUserConfig> {
  return readMcpFile(path);
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

/** Read <projectRoot>/.omp/mcp.json (project scope) without throwing. */
export async function readProjectMcpConfig(projectRoot: string): Promise<McpUserConfig> {
  return readMcpFile((await resolveProjectMcpConfig(projectRoot)).path);
}

async function readConfigFile(path: string): Promise<McpFile> {
  if (!(await Bun.file(path).exists())) return { mcpServers: {} };
  const parsed: unknown = JSON.parse(await Bun.file(path).text());
  if (!isRecord(parsed)) throw new Error(`${path} must contain a JSON object`);
  if (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers)) throw new Error('mcpServers must be an object');
  return parsed as McpFile;
}

async function writeConfigFile(path: string, config: McpFile): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(config, null, 2)}\n`);
}

async function writeServerAt(path: string, name: string, server: McpServer, previousName?: string): Promise<{ path: string }> {
  return withConfigLock(path, async () => {
    const config = await readConfigFile(path);
    const servers = { ...(config.mcpServers ?? {}) };
    // Capture the old entry before any rename: a rename must retain
    // credentials the browser intentionally redacts from its payload.
    const previous = servers[previousName ?? name];
    if (previousName && previousName !== name) delete servers[previousName];
    // The browser never receives existing credentials. Preserve them when an
    // edited server omits those fields, rather than deleting them on save.
    servers[name] = {
      ...server,
      ...(previous?.env !== undefined && server.env === undefined ? { env: previous.env } : {}),
      ...(previous?.headers !== undefined && server.headers === undefined ? { headers: previous.headers } : {}),
    };
    await writeConfigFile(path, { ...config, mcpServers: servers });
    return { path };
  });
}

async function deleteServerAt(path: string, name: string): Promise<{ path: string }> {
  if (!(await Bun.file(path).exists())) throw new Error('MCP server was not found');
  return withConfigLock(path, async () => {
    const config = await readConfigFile(path);
    const servers = { ...(config.mcpServers ?? {}) };
    if (!(name in servers)) throw new Error('MCP server was not found');
    delete servers[name];
    await writeConfigFile(path, { ...config, mcpServers: servers });
    return { path };
  });
}

/** Atomic read-modify-write of one server entry in the user mcp.json. */
export async function writeUserMcpServer(
  name: string,
  server: McpServer,
  path = join(getAgentDir(), 'mcp.json'),
  previousName?: string,
): Promise<{ path: string }> {
  if (!SERVER_NAME.test(name)) throw new Error('Invalid server name');
  if (!isRecord(server)) throw new Error('Server configuration must be an object');
  return writeServerAt(path, name, server, previousName);
}

/** Atomic removal of one server entry from the user mcp.json. */
export async function deleteUserMcpServer(name: string, path = join(getAgentDir(), 'mcp.json')): Promise<{ path: string }> {
  if (!SERVER_NAME.test(name)) throw new Error('Invalid server name');
  return deleteServerAt(path, name);
}

/** Atomic read-modify-write of one server entry in a project's mcp.json. */
export async function writeProjectMcpServer(
  projectRoot: string,
  name: string,
  server: McpServer,
  previousName?: string,
): Promise<{ path: string }> {
  if (!SERVER_NAME.test(name)) throw new Error('Invalid server name');
  if (!isRecord(server)) throw new Error('Server configuration must be an object');
  return writeServerAt((await resolveProjectMcpConfig(projectRoot)).path, name, server, previousName);
}

/** Atomic removal of one server entry from a project's mcp.json. */
export async function deleteProjectMcpServer(projectRoot: string, name: string): Promise<{ path: string }> {
  if (!SERVER_NAME.test(name)) throw new Error('Invalid server name');
  return deleteServerAt((await resolveProjectMcpConfig(projectRoot)).path, name);
}

/** Convert a native omp server config into Kabmo McpServerItem shape.
 *  Pass `project` to produce a project-scoped item (id omp-project-<name>). */
export function nativeToServerItem(
  name: string,
  config: McpServer,
  index: number,
  enabled: boolean,
  project?: { path: string },
) {
  const isHttp = typeof config.url === 'string';
  const envRecord = isRecord(config.env) ? (config.env as Record<string, unknown>) : {};
  return {
    id: `${project ? 'omp-project' : 'omp-user'}-${name}`,
    name,
    scope: project ? ('this-project' as const) : ('every-project' as const),
    ...(project ? { projectPath: project.path } : {}),
    enabled,
    reachType: isHttp ? ('link' as const) : ('command' as const),
    commandArgs: isHttp
      ? [String(config.url)]
      : [String(config.command ?? ''), ...(Array.isArray(config.args) ? config.args.map(String) : [])].filter(Boolean),
    linkUrl: isHttp ? String(config.url) : undefined,
    envVars: Object.entries(envRecord).map(([key, value], i) => ({
      id: `env-${index}-${i}`,
      key,
      value: typeof value === 'string' ? value : String(value),
    })),
    status: undefined,
  };
}

const SENSITIVE_KEY = /(key|token|secret|password|credential)/i;

/** Redact env var values for display — the browser never sees raw credentials. */
export function redactEnvVars<T extends { key: string; value: string }>(envVars: T[]): T[] {
  return envVars.map((item) => (SENSITIVE_KEY.test(item.key) ? { ...item, value: '••••••••' } : item));
}
