import { homedir } from 'os';
import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { isMockMode } from '@kabmo-labs/kabmo-runtime-flags';
import type { PluginCatalogItem, PluginItem, PluginMarketplaceItem, PluginScope } from '@/shared/types';
import { DEFAULT_PLUGIN_CATALOG, DEFAULT_PLUGIN_MARKETPLACES, DEFAULT_PLUGINS } from '@/client/data/settings/plugin';
import { resolveDiscoveryScope } from '@/server/lib/omp/config/scope';
import { reloadLiveSessions } from '@/server/lib/omp/session/reload.server';
import { listPlugins, readMarketplaceCatalog, readMarketplaces } from '@/server/lib/omp/config/plugins';
import {
  addMarketplace,
  deletePluginSetting,
  installPlugin,
  removeMarketplace,
  runPluginDoctor,
  setPluginEnabled,
  setPluginFeatures,
  setPluginSetting,
  uninstallPlugin,
  updateMarketplaces,
  upgradePlugins,
} from '@/server/lib/omp/config/plugin-actions';
import { pluginCliError, type PluginCommandResult } from '@/server/lib/omp/config/plugin-cli';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PluginPayload {
  plugins: PluginItem[];
  marketplaces: PluginMarketplaceItem[];
  catalog: PluginCatalogItem[];
  scope: 'user' | 'project';
  root: string | null;
  isMock: boolean;
}

/** Everything the panel renders, for one scope. */
async function readPayload(scope: 'user' | 'project', workspace: string | null, cwd: string): Promise<PluginPayload> {
  const [plugins, marketplaces] = await Promise.all([listPlugins(cwd), readMarketplaces()]);
  const installed = new Set(plugins.map((plugin) => plugin.id));
  const catalog = await readMarketplaceCatalog(installed);
  return { plugins, marketplaces, catalog, scope, root: workspace, isMock: false };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const mock = isMockMode();
  if (mock) {
    return json({
      plugins: DEFAULT_PLUGINS,
      marketplaces: DEFAULT_PLUGIN_MARKETPLACES,
      catalog: DEFAULT_PLUGIN_CATALOG,
      scope: 'user',
      root: null,
      isMock: true,
    } satisfies PluginPayload);
  }
  try {
    const url = new URL(request.url);
    const scope = await resolveDiscoveryScope(url.searchParams.get('root'), url.searchParams.get('scope'));
    if (!scope.workspace) return json(await readPayload('user', null, homedir()));
    return json(await readPayload('project', scope.workspace, scope.cwd));
  } catch (error) {
    return json({ error: errorMessage(error), plugins: [], marketplaces: [], catalog: [] }, { status: 500 });
  }
}

/**
 * The workspace a mutating request targets, and the cwd `omp plugin` must run in
 * for it.
 *
 * The scope rides on the query or the body, the way the skills route takes it,
 * and it decides the cwd rather than filtering after the fact — `omp plugin`
 * reads the PROJECT registry of the directory it runs in, so a project install
 * issued from the user scope would land in the wrong registry (or in none).
 *
 * The USER scope's cwd is `$HOME`, not the agent dir the skills route uses:
 * omp's own anchor walk deliberately stops before `$HOME` (`~/.omp` is the user
 * config dir), so a home cwd reads exactly the user registry — while
 * `~/.omp/agent` is merely *not* an anchor and would make omp look for
 * `~/.omp/agent/.omp/plugins` as a phantom project registry.
 */
async function resolveRequestScope(url: URL, body: Record<string, unknown>) {
  const rawRoot = url.searchParams.get('root') ?? (typeof body.root === 'string' ? body.root : null);
  const rawScope = url.searchParams.get('scope') ?? (typeof body.scope === 'string' ? body.scope : null);
  const resolved = await resolveDiscoveryScope(rawRoot, rawScope);
  if (!resolved.workspace) return { workspace: null, cwd: homedir(), scope: 'user' as PluginScope };
  return { workspace: resolved.workspace, cwd: resolved.cwd, scope: 'project' as PluginScope };
}

/** Re-read the panel after a mutation, so the UI shows omp's own state. */
async function afterMutation(target: { scope: PluginScope; workspace: string | null; cwd: string }, result: PluginCommandResult) {
  if (!result.ok) return json({ success: false, error: pluginCliError(result) }, { status: 400 });
  await reloadLiveSessions();
  return json({ success: true, ...(await readPayload(target.scope, target.workspace, target.cwd)) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST' && request.method !== 'PUT') {
    return methodNotAllowed({ request, params });
  }
  if (isMockMode()) return json({ success: true });

  try {
    const url = new URL(request.url);
    const body = (await request.json()) as Record<string, unknown>;
    const target = await resolveRequestScope(url, body);
    const type = typeof body.type === 'string' ? body.type : '';

    if (type === 'install') {
      const spec = typeof body.spec === 'string' ? body.spec.trim() : '';
      if (!spec) return json({ error: 'spec is required' }, { status: 400 });
      return afterMutation(target, await installPlugin(spec, target.cwd, target.scope));
    }

    if (type === 'uninstall') {
      const id = typeof body.id === 'string' ? body.id : '';
      if (!id) return json({ error: 'id is required' }, { status: 400 });
      // The scope is only sent when the plugin exists in BOTH registries: omp
      // refuses an ambiguous uninstall with its own message, and passing a scope
      // for a plugin installed in one scope only is itself an error there.
      return afterMutation(target, await uninstallPlugin(id, target.cwd, body.scope as PluginScope | undefined));
    }

    if (type === 'set_enabled') {
      const id = typeof body.id === 'string' ? body.id : '';
      if (!id) return json({ error: 'id is required' }, { status: 400 });
      return afterMutation(
        target,
        await setPluginEnabled(id, body.enabled === true, target.cwd, body.scope as PluginScope | undefined),
      );
    }

    if (type === 'upgrade') {
      const id = typeof body.id === 'string' && body.id ? body.id : null;
      return afterMutation(target, await upgradePlugins(id, target.cwd, body.scope as PluginScope | undefined));
    }

    // Features and settings are addressed by PACKAGE NAME, which is the lockfile
    // key and the name omp's `features`/`config` commands resolve. A bare
    // marketplace name exits 1 with `Plugin "<name>" not found`.
    if (type === 'set_features') {
      const packageName = typeof body.packageName === 'string' ? body.packageName : '';
      if (!packageName) return json({ error: 'packageName is required' }, { status: 400 });
      // omp's `features` command resolves the plugin from its USER plugin root
      // and writes the USER lockfile, so on a project-scoped install it would
      // report success while the ACTIVE (project) selection stayed unchanged —
      // verified on 18.4.4. The pane hides the control for that copy; this is
      // the same rule enforced where it cannot be bypassed by a stale client.
      if (body.pluginScope === 'project') {
        return json(
          {
            success: false,
            error:
              'omp writes plugin features through its user plugin root, so a project-scoped install’s selection cannot be changed here. Edit the workspace’s .omp/plugins/omp-plugins.lock.json directly.',
          },
          { status: 400 },
        );
      }
      const features = Array.isArray(body.features)
        ? body.features.filter((entry): entry is string => typeof entry === 'string')
        : [];
      return afterMutation(target, await setPluginFeatures(packageName, features, target.cwd));
    }

    if (type === 'set_setting') {
      const packageName = typeof body.packageName === 'string' ? body.packageName : '';
      const key = typeof body.key === 'string' ? body.key : '';
      if (!packageName || !key) return json({ error: 'packageName and key are required' }, { status: 400 });
      const value = body.value === undefined || body.value === null ? '' : String(body.value);
      return afterMutation(target, await setPluginSetting(packageName, key, value, target.cwd));
    }

    if (type === 'delete_setting') {
      const packageName = typeof body.packageName === 'string' ? body.packageName : '';
      const key = typeof body.key === 'string' ? body.key : '';
      if (!packageName || !key) return json({ error: 'packageName and key are required' }, { status: 400 });
      return afterMutation(target, await deletePluginSetting(packageName, key, target.cwd));
    }

    if (type === 'add_marketplace') {
      const source = typeof body.source === 'string' ? body.source.trim() : '';
      if (!source) return json({ error: 'source is required' }, { status: 400 });
      // Marketplaces are USER-level state — omp reads them from
      // `<dataRoot>/marketplaces.json`, which no cwd changes — so this action's
      // cwd only decides which plugin registries the refreshed payload lists.
      return afterMutation(target, await addMarketplace(source, target.cwd));
    }

    if (type === 'remove_marketplace') {
      const name = typeof body.name === 'string' ? body.name : '';
      if (!name) return json({ error: 'name is required' }, { status: 400 });
      return afterMutation(target, await removeMarketplace(name, target.cwd));
    }

    if (type === 'update_marketplace') {
      const name = typeof body.name === 'string' && body.name ? body.name : null;
      return afterMutation(target, await updateMarketplaces(name, target.cwd));
    }

    if (type === 'doctor') {
      const result = await runPluginDoctor(target.cwd);
      if (!result.ok) return json({ success: false, error: pluginCliError(result) }, { status: 400 });
      let checks: unknown = [];
      try {
        checks = JSON.parse(result.stdout);
      } catch {
        checks = [];
      }
      return json({ success: true, checks });
    }

    return json({ error: 'Unsupported plugin action' }, { status: 400 });
  } catch (error) {
    return json({ error: errorMessage(error) }, { status: 500 });
  }
}
