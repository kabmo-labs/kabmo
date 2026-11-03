import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import type { DbClient } from '@/server/lib/db/client';
import { getDb } from '@/server/db.server';
import { DEFAULT_MCP_SERVERS } from '@/client/data/settings/mcp';
import { isMockMode } from '@/server/mock.server';
import { createSettingsListStore } from '@/server/lib/db/settings-store';
import { resolveRoot } from '@/server/lib/fs/root';
import type { McpServerItem } from '@/shared/types';
import { deleteProjectMcpServer, deleteUserMcpServer, nativeToServerItem, readProjectMcpConfig, readUserMcpConfig, redactEnvVars, writeProjectMcpServer, writeUserMcpServer } from '@/server/lib/omp/config/mcp';

const mcpStore = createSettingsListStore<McpServerItem>({
  key: 'omp_mcp_servers',
  mockDefaults: DEFAULT_MCP_SERVERS,
  idOf: (server) => server.id,
  singular: 'server',
  plural: 'servers',
});

const NATIVE_USER_PREFIX = 'omp-user-';
const NATIVE_PROJECT_PREFIX = 'omp-project-';

async function readCustomServers(db: DbClient): Promise<McpServerItem[]> {
  return mcpStore.readStored(db, { absent: isMockMode() ? DEFAULT_MCP_SERVERS : [] });
}

async function writeCustomServers(db: DbClient, servers: McpServerItem[]): Promise<void> {
  await mcpStore.write(db, servers);
}

/** Resolve a client-supplied path to a registered workspace project root. */
async function validateProjectPath(raw: unknown): Promise<string | null> {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const resolved = await resolveRoot(raw, '');
  if (!resolved) return null;
  const db = await getDb();
  const row = await db.get(
    'SELECT project_path FROM workspace_folders WHERE project_path IS NOT NULL AND project_path = ? LIMIT 1',
    [resolved],
  );
  return row ? resolved : null;
}

/** App-local rows scoped to a project are only visible inside that project. */
function customForProject(custom: McpServerItem[], projectPath?: string): McpServerItem[] {
  return custom.filter((server) =>
    server.scope !== 'this-project'
      ? true
      : Boolean(server.projectPath && projectPath && server.projectPath === projectPath),
  );
}

/** Merge native user + project servers with app-local custom servers; native wins on name. */
async function mergeServers(custom: McpServerItem[], projectPath?: string): Promise<McpServerItem[]> {
  const user = await readUserMcpConfig();
  const userItems: McpServerItem[] = user.servers.map((entry, index) =>
    nativeToServerItem(entry.name, entry.config, index, !user.disabledServers.includes(entry.name)),
  );
  const project = projectPath ? await readProjectMcpConfig(projectPath) : undefined;
  const projectItems: McpServerItem[] = projectPath && project
    ? project.servers.map((entry, index) =>
        nativeToServerItem(entry.name, entry.config, index, !project.disabledServers.includes(entry.name), {
          path: projectPath,
        }),
      )
    : [];
  const natives = [...userItems, ...projectItems].map((item) => ({ ...item, envVars: redactEnvVars(item.envVars) }));
  const nativeNames = new Set(natives.map((item) => item.name.toLowerCase()));
  return [
    ...natives,
    ...customForProject(custom, projectPath).filter((server) => !nativeNames.has(server.name.toLowerCase())),
  ];
}

interface McpNativePayloadSource {
  reachType?: unknown;
  linkUrl?: unknown;
  commandArgs?: unknown;
  envVars?: unknown;
}

/** Convert a browser McpServerItem payload into native omp mcp.json shape. */
function toNativeServer(ui: McpNativePayloadSource): Record<string, unknown> {
  const commandArgs = Array.isArray(ui.commandArgs) ? ui.commandArgs.map(String) : [];
  const isLink = ui.reachType === 'link' || typeof ui.linkUrl === 'string';
  const nativeServer: Record<string, unknown> = isLink
    ? { url: String(ui.linkUrl ?? commandArgs[0] ?? '') }
    : { command: commandArgs[0] ?? '', ...(commandArgs.length > 1 ? { args: commandArgs.slice(1) } : {}) };
  if (Array.isArray(ui.envVars) && ui.envVars.length > 0) {
    const env: Record<string, string> = {};
    for (const item of ui.envVars) {
      if (item && typeof item.key === 'string' && typeof item.value === 'string' && item.value !== '••••••••') {
        env[item.key] = item.value;
      }
    }
    if (Object.keys(env).length > 0) nativeServer.env = env;
  }
  return nativeServer;
}

/** Previous native name encoded in a native id, when the form renamed the server. */
function previousNativeName(id: unknown, name: string): string | undefined {
  if (typeof id !== 'string') return undefined;
  const prefix = id.startsWith(NATIVE_USER_PREFIX)
    ? NATIVE_USER_PREFIX
    : id.startsWith(NATIVE_PROJECT_PREFIX)
      ? NATIVE_PROJECT_PREFIX
      : null;
  if (!prefix) return undefined;
  const previous = id.slice(prefix.length);
  return previous && previous !== name ? previous : undefined;
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const db = await getDb();
    const url = new URL(request.url);
    const scope = url.searchParams.get('scope'); // "user" = include native omp config
    const includeNative = scope === 'user' || !isMockMode();
    const mock = isMockMode();

    const rawProject = url.searchParams.get('project');
    const projectPath = rawProject ? await validateProjectPath(rawProject) : null;
    if (rawProject && !projectPath) {
      return json({ error: 'Project is not a registered workspace folder' }, { status: 400 });
    }

    let servers = await mcpStore.read(db);

    if (includeNative && !mock) {
      servers = await mergeServers(servers, projectPath ?? undefined);
    }

    return json({
      servers,
      isMock: mock,
      nativePath: includeNative ? (await readUserMcpConfig()).path : undefined,
      projectPath: projectPath ?? undefined,
    });
  } catch (error: any) {
    const mock = isMockMode();
    return json({ error: error.message, servers: mock ? DEFAULT_MCP_SERVERS : [], isMock: mock }, { status: 500 });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    const db = await getDb();

    if (request.method === 'DELETE') {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'id is required' }, { status: 400 });

      const rawProjectPath = url.searchParams.get('projectPath');
      const projectPath = rawProjectPath ? await validateProjectPath(rawProjectPath) : null;
      if (rawProjectPath && !projectPath) {
        return json({ error: 'Project is not a registered workspace folder' }, { status: 400 });
      }

      let custom = await readCustomServers(db);
      const target = custom.find((server) => server.id === id);

      // Native omp server deletion (id prefix omp-user-/omp-project-) hits mcp.json directly.
      if (id.startsWith(NATIVE_USER_PREFIX)) {
        const name = id.slice(NATIVE_USER_PREFIX.length);
        try { await deleteUserMcpServer(name); } catch {}
        custom = custom.filter((server) => server.name.toLowerCase() !== name.toLowerCase());
        await writeCustomServers(db, custom);
        return json({ success: true, servers: await mergeServers(custom, projectPath ?? undefined) });
      }

      if (id.startsWith(NATIVE_PROJECT_PREFIX)) {
        const name = id.slice(NATIVE_PROJECT_PREFIX.length);
        if (!projectPath) {
          return json({ error: 'projectPath is required for project-scoped servers' }, { status: 400 });
        }
        try { await deleteProjectMcpServer(projectPath, name); } catch {}
        custom = custom.filter((server) => server.name.toLowerCase() !== name.toLowerCase());
        await writeCustomServers(db, custom);
        return json({ success: true, servers: await mergeServers(custom, projectPath) });
      }

      // App-local row: remove it and any native entry it mirrors, so a deleted
      // native server cannot resurrect as a DB ghost.
      if (target) {
        try {
          if (target.scope === 'this-project') {
            const mirrorPath = target.projectPath ?? projectPath;
            const targetProject = mirrorPath ? await validateProjectPath(mirrorPath) : null;
            if (targetProject) await deleteProjectMcpServer(targetProject, target.name);
          } else {
            await deleteUserMcpServer(target.name);
          }
        } catch {}
      }
      custom = custom.filter((server) => server.id !== id);
      await writeCustomServers(db, custom);
      return json({ success: true, servers: isMockMode() ? custom : await mergeServers(custom, projectPath ?? undefined) });
    }

    if (request.method === 'POST' || request.method === 'PUT') {
      const body = await request.json();

      // Backward-compatible explicit user-scope write: { scope: "user", name, server }
      if (body.scope === 'user' && typeof body.name === 'string' && body.server) {
        await writeUserMcpServer(body.name, toNativeServer(body.server));
        const custom = await readCustomServers(db);
        return json({ success: true, servers: await mergeServers(custom) });
      }

      if (Array.isArray(body) || Array.isArray(body.servers)) {
        const updatedServers: McpServerItem[] = Array.isArray(body) ? body : body.servers;
        await writeCustomServers(db, updatedServers);
        return json({ success: true, servers: isMockMode() ? updatedServers : await mergeServers(updatedServers) });
      }

      if (!body.server) return json({ error: 'server is required' }, { status: 400 });

      const server: McpServerItem = body.server;
      if (typeof server.name !== 'string' || !server.name.trim()) {
        return json({ error: 'Server name is required' }, { status: 400 });
      }

      const rawProject = typeof body.projectPath === 'string' && body.projectPath.trim()
        ? body.projectPath
        : server.projectPath;
      let projectPath: string | null = null;
      if (rawProject) {
        projectPath = await validateProjectPath(rawProject);
        if (!projectPath) {
          return json({ error: 'Project is not a registered workspace folder' }, { status: 400 });
        }
      }

      const mock = isMockMode();
      const previousName = previousNativeName(server.id, server.name);
      if (!mock) {
        if (server.scope === 'this-project') {
          if (!projectPath) {
            return json({ error: 'A registered projectPath is required for project-scoped servers' }, { status: 400 });
          }
          await writeProjectMcpServer(projectPath, server.name, toNativeServer(server), previousName);
        } else {
          await writeUserMcpServer(server.name, toNativeServer(server), undefined, previousName);
        }
      }

      // Upsert the DB row so ids/enabled stay stable across scope changes.
      const storedServer: McpServerItem = projectPath ? { ...server, projectPath } : server;
      const upserted = await mcpStore.upsertItem(db, storedServer, { absent: mock ? DEFAULT_MCP_SERVERS : [] });
      // A RENAME leaves the old name behind as a second row: the native file is
      // rewritten under the new name, but the app-local row that mirrored the
      // old one still answers the old name and the panel lists both. The row is
      // the one thing the native write cannot clean up.
      const custom = previousName
        ? upserted.filter((entry) => entry.name.toLowerCase() !== previousName.toLowerCase())
        : upserted;
      await writeCustomServers(db, custom);

      return json({ success: true, servers: mock ? custom : await mergeServers(custom, projectPath ?? undefined) });
    }

    return methodNotAllowed({ request, params });
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
}
