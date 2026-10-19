/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether a plugin can run on THIS chamber.
 *
 * Two questions, both answered by naming both sides: an `engines` range the
 * running version does not satisfy, and a capability the host does not provide.
 * A plugin refused here is REPORTED with its reason rather than loaded — an
 * incompatible bundle misbehaves later and somewhere that names nothing, while
 * this refusal names the requirement and the version.
 *
 * The chamber's own versions are resolved from the running install rather than
 * baked in, and a version that cannot be resolved refuses NOTHING: failing
 * closed on our own missing metadata would take working plugins down with it.
 * Only the plugin's DECLARED mismatch fails closed.
 */

import { join } from 'path';
import type { PanelPluginManifest } from '@/shared/types';
import { packageDir } from '@/server/lib/fs/package-root';
import { chamberPackageDirs } from '@/server/lib/panels/link.server';
import { missingCapabilities } from '@/shared/lib/panels/capabilities';
import { satisfiesRange } from '@/shared/lib/updates/semver';

/** The versions a plugin's `engines` is compared against; null means unknown. */
export interface RunningVersions {
  ompchamber: string | null;
  pluginSdk: string | null;
}

/** Read a package's `version`, or null when the file is absent or unreadable. */
async function readPackageVersion(dir: string): Promise<string | null> {
  try {
    const parsed = (await Bun.file(join(dir, 'package.json')).json()) as { version?: unknown };
    return typeof parsed?.version === 'string' && parsed.version.trim() ? parsed.version.trim() : null;
  } catch {
    return null;
  }
}

/** The running chamber's own versions, resolved once per scan. */
export async function runningVersions(): Promise<RunningVersions> {
  const dirs = chamberPackageDirs();
  const sdkDir = dirs['@kabmo-labs/plugin-sdk'] ?? dirs['@ompchamber/plugin-sdk'];
  return {
    ompchamber: await readPackageVersion(packageDir()),
    pluginSdk: sdkDir ? await readPackageVersion(sdkDir) : null,
  };
}

/**
 * Why this manifest cannot run here, or null when it can.
 *
 * Both sides of every comparison are named, because the pane's only repair is
 * the author editing a range, and "incompatible" alone says nothing about which
 * number is wrong.
 */
export function describeIncompatibility(manifest: PanelPluginManifest, running: RunningVersions): string | null {
  const engines = manifest.engines;
  if (engines) {
    const checks: readonly [string, string | undefined, string | null, string][] = [
      ['ompchamber', engines.ompchamber, running.ompchamber, 'this chamber'],
      ['pluginSdk', engines.pluginSdk, running.pluginSdk, 'this plugin SDK'],
    ];
    for (const [key, range, version, label] of checks) {
      if (range && version && !satisfiesRange(version, range)) {
        return `manifest requires ${key} ${range} but ${label} is ${version}`;
      }
    }
  }
  const missing = missingCapabilities(manifest.capabilities ?? []);
  if (missing.length > 0) {
    return `manifest requires capability "${missing[0]}" which this chamber does not provide`;
  }
  return null;
}
