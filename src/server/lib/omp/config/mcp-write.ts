/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Writing a native `mcp.json` entry — user scope or project scope.
 *
 * Two facts make this more than a JSON edit:
 *  - the enablement lists (`disabledServers` / `enabledServers`) live in the
 *    USER file even when the entry is project-scoped, so a project save updates
 *    both files;
 *  - credential-bearing blocks the browser only ever sees redacted must be
 *    carried over from the previous entry instead of being erased.
 */

import { isRecord } from '@/shared/lib/util/guards';
import { writeFileAtomic } from '@/server/lib/fs/atomic-write';
import { withConfigLock } from '@/server/lib/fs/config-lock';
import { resolveProjectMcpConfig } from '@/server/lib/omp/config/mcp';
import {
  SERVER_NAME,
  stringsIn,
  userMcpConfigPath,
  type McpFile,
  type McpServer,
} from '@/server/lib/omp/config/mcp-shared';

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

/** Apply one server's enablement to the user-level denylist/allowlist pair. */
function withEnabledLists(
  config: McpFile,
  name: string,
  previousName: string | undefined,
  enabled: boolean | undefined,
): McpFile {
  const disabled = new Set(stringsIn(config.disabledServers));
  const enabledList = new Set(stringsIn(config.enabledServers));
  for (const candidate of [name, previousName]) {
    if (!candidate) continue;
    disabled.delete(candidate);
    enabledList.delete(candidate);
  }
  if (enabled === false) disabled.add(name);
  const next: McpFile = { ...config };
  if (disabled.size > 0) next.disabledServers = [...disabled].sort();
  else delete next.disabledServers;
  if (enabledList.size > 0) next.enabledServers = [...enabledList].sort();
  else delete next.enabledServers;
  return next;
}

async function applyEnabledLists(
  path: string,
  name: string,
  previousName: string | undefined,
  enabled: boolean | undefined,
): Promise<void> {
  await withConfigLock(path, async () => {
    const config = await readConfigFile(path);
    const disabled = stringsIn(config.disabledServers);
    const allowed = stringsIn(config.enabledServers);
    const touches = [name, previousName].filter((entry): entry is string => Boolean(entry));
    const changes =
      enabled === false ||
      touches.some((entry) => disabled.includes(entry) || allowed.includes(entry));
    // A project-scope write must not create a user `mcp.json` that omp did not
    // have: when neither list mentions the server, there is nothing to record.
    if (!changes) return;
    await writeConfigFile(path, withEnabledLists(config, name, previousName, enabled));
  });
}

async function writeServerAt(
  path: string,
  name: string,
  server: McpServer,
  previousName?: string,
  listsPath = path,
): Promise<{ path: string }> {
  return withConfigLock(path, async () => {
    const config = await readConfigFile(path);
    const servers = { ...(config.mcpServers ?? {}) };
    // Capture the old entry before any rename: a rename must retain
    // credentials the browser intentionally redacts from its payload.
    const previous = servers[previousName ?? name];
    if (previousName && previousName !== name) delete servers[previousName];
    const merged: Record<string, unknown> = { ...server };
    for (const key of ['env', 'headers'] as const) {
      if (previous?.[key] !== undefined && merged[key] === undefined) merged[key] = previous[key];
    }
    // `auth`/`oauth` carry credentials the browser only ever sees redacted, so
    // they merge per FIELD: a form that edits `scope` and leaves `clientSecret`
    // blank must not erase the stored secret.
    for (const key of ['auth', 'oauth'] as const) {
      const incoming = merged[key];
      if (isRecord(incoming)) {
        const prior = isRecord(previous?.[key]) ? previous[key] : undefined;
        merged[key] = { ...(prior ?? {}), ...incoming };
      } else if (previous?.[key] !== undefined) {
        merged[key] = previous[key];
      }
    }
    const enabled = merged.enabled === false ? false : merged.enabled === true ? true : undefined;
    if (enabled === false) merged.enabled = false;
    else delete merged.enabled;
    servers[name] = merged;
    const next = listsPath === path
      ? withEnabledLists({ ...config, mcpServers: servers }, name, previousName, enabled)
      : { ...config, mcpServers: servers };
    await writeConfigFile(path, next);
    if (listsPath !== path) await applyEnabledLists(listsPath, name, previousName, enabled);
    return { path };
  });
}

async function deleteServerAt(path: string, name: string, listsPath = path): Promise<{ path: string }> {
  if (!(await Bun.file(path).exists())) throw new Error('MCP server was not found');
  return withConfigLock(path, async () => {
    const config = await readConfigFile(path);
    const servers = { ...(config.mcpServers ?? {}) };
    if (!(name in servers)) throw new Error('MCP server was not found');
    delete servers[name];
    const next = listsPath === path
      ? withEnabledLists({ ...config, mcpServers: servers }, name, undefined, undefined)
      : { ...config, mcpServers: servers };
    await writeConfigFile(path, next);
    if (listsPath !== path) await applyEnabledLists(listsPath, name, undefined, undefined);
    return { path };
  });
}

/** Atomic read-modify-write of one server entry in the user mcp.json. */
export async function writeUserMcpServer(
  name: string,
  server: McpServer,
  path = userMcpConfigPath(),
  previousName?: string,
): Promise<{ path: string }> {
  if (!SERVER_NAME.test(name)) throw new Error('Invalid server name');
  if (!isRecord(server)) throw new Error('Server configuration must be an object');
  return writeServerAt(path, name, server, previousName);
}

/** Atomic removal of one server entry from the user mcp.json. */
export async function deleteUserMcpServer(name: string, path = userMcpConfigPath()): Promise<{ path: string }> {
  if (!SERVER_NAME.test(name)) throw new Error('Invalid server name');
  return deleteServerAt(path, name);
}

/** Atomic read-modify-write of one server entry in a project's mcp.json.
 *  Enablement lists live in the USER file, so a project write updates both. */
export async function writeProjectMcpServer(
  projectRoot: string,
  name: string,
  server: McpServer,
  previousName?: string,
): Promise<{ path: string }> {
  if (!SERVER_NAME.test(name)) throw new Error('Invalid server name');
  if (!isRecord(server)) throw new Error('Server configuration must be an object');
  return writeServerAt((await resolveProjectMcpConfig(projectRoot)).path, name, server, previousName, userMcpConfigPath());
}

/** Atomic removal of one server entry from a project's mcp.json. */
export async function deleteProjectMcpServer(projectRoot: string, name: string): Promise<{ path: string }> {
  if (!SERVER_NAME.test(name)) throw new Error('Invalid server name');
  return deleteServerAt((await resolveProjectMcpConfig(projectRoot)).path, name, userMcpConfigPath());
}
