/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether a plugin can run on THIS Kabmo.
 *
 * Two questions, both answered by naming both sides: an `engines` range the
 * running version does not satisfy, and a capability the host does not provide.
 * A plugin refused here is REPORTED with its reason rather than loaded — an
 * incompatible bundle misbehaves later and somewhere that names nothing, while
 * this refusal names the requirement and the version.
 *
 * The Kabmo's own versions are resolved from the running install rather than
 * baked in, and a version that cannot be resolved refuses NOTHING: failing
 * closed on our own missing metadata would take working plugins down with it.
 * Only the plugin's DECLARED mismatch fails closed.
 */

import { join } from 'path';
import type { PanelPluginManifest } from '@/shared/types';
import { packageDir } from '@/server/lib/fs/package-root';
import { kabmoPackageDirs } from '@/server/lib/panels/link.server';
import { missingCapabilities } from '@/shared/lib/panels/capabilities';
import { satisfiesRange } from '@/shared/lib/updates/semver';

/** The versions a plugin's `engines` is compared against; null means unknown. */
export interface RunningVersions {
  kabmo: string | null;
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

/** The running Kabmo's own versions, resolved once per scan. */
export async function runningVersions(): Promise<RunningVersions> {
  const dirs = kabmoPackageDirs();
  const sdkDir = dirs['@kabmo-labs/kabmo-sdk'] ?? dirs['@kabmo-labs/plugin-sdk'] ?? dirs['@ompchamber/plugin-sdk'];
  return {
    kabmo: await readPackageVersion(packageDir()),
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
      ['kabmo', engines.kabmo, running.kabmo, 'Kabmo'],
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
    return `manifest requires capability "${missing[0]}" which Kabmo does not provide`;
  }
  return null;
}
