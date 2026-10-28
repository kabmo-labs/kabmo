/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One pass over the working marketplace's `plugins/` directory.
 *
 * Split out of `registry.server.ts` because that file also owns the marketplace
 * roots, the scan cache and the payload assembly, and the loop alone is a third
 * of it. The boundary is a fact about the loop: everything here reads ONE plugin
 * directory and answers what it is, while nothing here decides which
 * directories exist, what the payload looks like, or whether a scan is cached.
 *
 * A rejection is pushed through `fail` rather than thrown, because a plugin that
 * cannot load must not stop the scan — the pane reports it by name and the other
 * plugins keep working.
 */

import { join } from 'path';
import type {
  PanelPluginError,
  PanelPluginStatus,
  PanelRegistryEntry,
} from '@/shared/types';
import { pathExists } from '@/server/lib/omp/core/paths';
import { pluginEnablementKey } from '@/shared/lib/workspace/panel-ids';
import { readPluginManifest, subdirectories } from '@/server/lib/panels/files.server';
import { toManifest } from '@/server/lib/panels/manifest';
import { bundleUrl, cssUrl, iconUrl, readmeUrlFor } from '@/server/lib/panels/assets.server';
import { readGitOrigin } from '@/server/lib/panels/git-clone.server';
import { describeIncompatibility, type RunningVersions } from '@/server/lib/panels/compat.server';

/** What one pass produced, in the four shapes the payload needs. */
export interface ScannedPlugins {
  /** Every plugin whose manifest parsed, enabled or not, built or not. */
  pluginStatus: PanelPluginStatus[];
  /** The bundles the host should import — enabled, built, and with an `app`. */
  panels: PanelRegistryEntry[];
  /** Plugin id → its directory, for the asset routes. */
  dirs: Record<string, string>;
  errors: PanelPluginError[];
}

/**
 * Read every plugin directory, in one pass.
 *
 * `disabled` is a `Set` of ENABLEMENT keys (`plugin:<id>`) and `running` is the
 * versions this host actually runs, resolved once by the caller — a plugin's
 * `engines` is compared against what is running HERE, never a constant.
 */
export async function scanInstalledPlugins(options: {
  pluginsRoot: string;
  disabled: ReadonlySet<string>;
  running: RunningVersions;
  /** The marketplace every rejection is attributed to. */
  marketplace: string;
}): Promise<ScannedPlugins> {
  const { pluginsRoot, disabled, running, marketplace } = options;
  const scanned: ScannedPlugins = { pluginStatus: [], panels: [], dirs: {}, errors: [] };
  const fail = (dir: string, reason: string) =>
    scanned.errors.push({ dir, reason, marketplace });

  for (const pluginName of await subdirectories(pluginsRoot)) {
    const pluginDir = join(pluginsRoot, pluginName);
    const read = await readPluginManifest(pluginDir);
    if (read.kind === 'none') continue;
    if (read.kind === 'error') {
      fail(pluginDir, read.reason);
      continue;
    }
    const manifest = toManifest(read.value, pluginDir);
    if ('error' in manifest) {
      fail(pluginDir, manifest.error);
      continue;
    }

    // Refused BEFORE it is admitted: an incompatible plugin must contribute
    // nothing — no panel, no bundle, no directory for the route to resolve.
    // The reason names both sides, because the pane's only repair is the author
    // editing the range.
    const refusal = describeIncompatibility(manifest, running);
    if (refusal) {
      fail(pluginDir, refusal);
      continue;
    }

    // A plugin is served from its build output, so every entry its manifest
    // declares must already exist. A plugin whose build has not run is reported
    // as UNBUILT rather than as broken — the manifest is fine, and the pane
    // offers to run the build — which is why this is a separate list from
    // `errors`. A plugin with BOTH an app and a server needs both.
    const isPackage = await pathExists(join(pluginDir, 'package.json'));
    // A plugin's enablement key carries the SAME prefix the client uses for its
    // panel id (`plugin:<id>`), so one stored list answers for both kinds. Testing
    // the bare manifest id here made a disabled plugin still report `enabled:
    // true` while its panel stayed hidden — two answers for one question.
    const enabled = !disabled.has(pluginEnablementKey(manifest.id));
    const entries = [manifest.app, manifest.server].filter((entry): entry is string => Boolean(entry));
    let missingEntry: string | undefined;
    for (const entry of entries) {
      if (!(await pathExists(join(pluginDir, entry)))) {
        missingEntry = entry;
        break;
      }
    }
    const built = missingEntry === undefined;
    // The clone's own origin is what makes a plugin updatable. Read here rather
    // than stored at install time: the directory is the install, so a URL kept
    // beside it could disagree with it.
    const gitOrigin = await readGitOrigin(pluginDir);
    scanned.pluginStatus.push({
      pluginId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      isPackage,
      built,
      enabled,
      // Both are corrected by `applySources` once the catalogs have been read:
      // whether this install came from the store is a property of the SOURCE,
      // which is not knowable from the directory alone.
      bundled: false,
      origin: gitOrigin ? 'git' : 'local',
      gitOrigin,
      settingsCount: Object.keys(manifest.settings ?? {}).length,
      ...(manifest.description ? { description: manifest.description } : {}),
      ...(manifest.author ? { author: manifest.author } : {}),
      ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
      ...(manifest.slots ? { slots: manifest.slots } : {}),
      ...(manifest.capabilities ? { capabilities: manifest.capabilities } : {}),
      ...(missingEntry ? { reason: `the build produced no ${missingEntry}` } : {}),
    });
    // A switched-off plugin contributes NOTHING: no button, no tab, and no
    // bundle for the route to serve. Its files stay on disk, which is the whole
    // difference between disabling and removing.
    if (!enabled || !built) continue;
    // The directory map is the asset routes' root, so it is filled even for a
    // server-only plugin: its README and icon are still served.
    scanned.dirs[manifest.id] = pluginDir;
    // `panels` is the list of UI bundles the host IMPORTS, so a plugin with no
    // `app` contributes none — its work happens on the server, not in the page.
    if (!manifest.app) continue;

    scanned.panels.push({
      pluginId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      appUrl: await bundleUrl(pluginDir, manifest.app),
      // Only when the plugin DECLARED a stylesheet and the file is actually
      // there. A manifest that names a `css` the build did not emit would
      // otherwise put a 404 URL in the payload and a console error on every
      // load, for a stylesheet the plugin does not have.
      ...(manifest.css && (await pathExists(join(pluginDir, manifest.css)))
        ? { cssUrl: await cssUrl(pluginDir, manifest.css) }
        : {}),
      ...(manifest.icon ? { iconUrl: await iconUrl(pluginDir, manifest.icon) } : {}),
      ...(await readmeUrlFor(pluginDir, manifest)),
    });
  }

  return scanned;
}
