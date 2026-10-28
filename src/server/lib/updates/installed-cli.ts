/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where an installed copy of the product lives on disk, and which CLI file
 * restarts it.
 *
 * The restart after an update must launch the copy the update INSTALLED, not
 * the one that is running. That distinction did not exist until the rename:
 * `bun add -g @kabmo-labs/kabmo` installs a DIFFERENT package beside
 * `ompchamber`, so a server that resolved the restart from its own directory
 * kept respawning the pre-rename build — measured on the 4.23.1 → 0.0.1 move,
 * where the log read `.../node_modules/ompchamber/src/cli/ompchamber.js restart
 * --port 3001` and the console came back as 4.23.1 while the update reported
 * success. The same mistake returns in the other direction for a later rename,
 * which is why the rule lives here rather than in a comment.
 *
 * The CLI file comes from the package's own `bin` map, never from a guessed
 * filename: a package ships whatever it registers, so a hard-coded
 * `kabmo.js` finds nothing in a copy that names its bin something else.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { resolveBunBin } from '@/server/lib/lifecycle/bun';

export interface InstalledCopy {
  /** Package root: the directory holding this copy's `package.json` and `src/`. */
  root: string;
  /** `name` from that `package.json` (`ompchamber` before the rename, `@kabmo-labs/kabmo` after). */
  packageName: string;
  /** The bin key this copy registers — the name a user types. */
  bin: string;
  /** Absolute path to that bin's script. */
  cli: string;
}

interface Manifest {
  name?: unknown;
  bin?: unknown;
}

function readManifest(root: string): Manifest | null {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest;
  } catch {
    return null;
  }
}

/** `@kabmo-labs/kabmo` → `kabmo`: the name a package's own bin is registered under. */
function unscoped(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1);
}

function binEntries(manifest: Manifest): Array<[string, string]> {
  const { bin } = manifest;
  // A string `bin` is registered under the package's own (unscoped) name.
  if (typeof bin === 'string' && bin.length > 0) {
    const name = typeof manifest.name === 'string' ? unscoped(manifest.name) : '';
    return name.length > 0 ? [[name, bin]] : [];
  }
  if (!bin || typeof bin !== 'object') return [];
  return Object.entries(bin as Record<string, unknown>).flatMap(([key, value]) =>
    typeof value === 'string' && value.length > 0 ? [[key, value] as [string, string]] : [],
  );
}

/**
 * The copy rooted at `root`, or null when no package (or no runnable bin) is
 * there.
 *
 * The bin is preferred by NAME — `@kabmo-labs/kabmo` → `kabmo`, `ompchamber` →
 * `ompchamber` — so a package that registers several scripts (the bridge
 * release registers both) resolves to its own CLI instead of whichever key
 * happens to come first.
 */
export function copyAt(root: string): InstalledCopy | null {
  const resolved = resolve(root);
  const manifest = readManifest(resolved);
  if (!manifest) return null;

  const packageName = typeof manifest.name === 'string' ? manifest.name : '';
  const entries = binEntries(manifest);
  const own = unscoped(packageName);
  const ordered = [...entries.filter(([bin]) => bin === own), ...entries.filter(([bin]) => bin !== own)];

  for (const [bin, script] of ordered) {
    const cli = resolve(resolved, script);
    if (existsSync(cli)) return { root: resolved, packageName, bin, cli };
  }
  return null;
}

/**
 * The package directory behind a Bun bin directory.
 *
 * `bun pm bin -g` answers `<BUN_INSTALL>/bin`, and the packages sit one layout
 * step away — the same `install/global/node_modules` shape
 * `detectInstallMethod` matches. Named rather than inlined because the step is
 * the one fact this module exists to get right.
 */
export function nodeModulesForBinDir(binDir: string): string {
  return join(dirname(binDir), 'install', 'global', 'node_modules');
}

/**
 * Bun's global `node_modules`, asked from the installer itself.
 *
 * `BUN_INSTALL` is the fallback for a Bun too old to answer `bun pm bin -g`; a
 * host with neither still resolves the documented default, so the caller's own
 * existence check decides.
 */
export function globalNodeModules(bunBin: string = resolveBunBin()): string {
  try {
    const probe = Bun.spawnSync({
      cmd: [bunBin, 'pm', 'bin', '-g'],
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
      timeout: 15_000,
    });
    const binDir = probe.exitCode === 0 ? probe.stdout.toString().trim() : '';
    if (binDir.length > 0) return nodeModulesForBinDir(binDir);
  } catch {
    // Fall through to the environment, then to the documented default.
  }
  const installRoot = (Bun.env.BUN_INSTALL ?? '').trim();
  return join(installRoot.length > 0 ? resolve(installRoot) : join(homedir(), '.bun'), 'install', 'global', 'node_modules');
}

/** The global copy of `packageName`, or null when it is not installed. */
export function resolveInstalledCopy(packageName: string, bunBin: string = resolveBunBin()): InstalledCopy | null {
  return copyAt(join(globalNodeModules(bunBin), packageName));
}
