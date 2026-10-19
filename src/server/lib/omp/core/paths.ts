/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Read-only port of omp-web's agent-directory resolution
 * (omp-web/lib/omp/paths.ts → oh-my-pi packages/utils/src/dirs.ts).
 *
 * Resolves where oh-my-pi keeps its agent state so Kabmo can *discover*
 * the same workspaces and sessions the omp agent writes, without owning or
 * mutating them. Covered: PI_CODING_AGENT_DIR override, PI_CONFIG_DIR rename,
 * and the XDG data layout (used only when $XDG_DATA_HOME/omp already exists).
 */

import { existsSync, realpathSync } from 'fs';
import { homedir, tmpdir } from 'os';
import * as path from 'path';

const APP_NAME = 'omp';
const CONFIG_DIR_NAME = '.omp';

/** Config root name (~/.omp), honoring the PI_CONFIG_DIR rename. */
export function getConfigDirName(): string {
  return Bun.env.PI_CONFIG_DIR || CONFIG_DIR_NAME;
}

/** Config root: ~/.omp (plus PI_CONFIG_DIR rename). */
export function getConfigRoot(): string {
  return path.join(homedir(), getConfigDirName());
}

/** The agent state directory (~/.omp/agent). PI_CODING_AGENT_DIR overrides it. */
export function getAgentDir(): string {
  const override = Bun.env.PI_CODING_AGENT_DIR;
  if (override) return path.resolve(override);
  return path.join(getConfigRoot(), 'agent');
}

function isDefaultAgentDir(): boolean {
  const override = Bun.env.PI_CODING_AGENT_DIR;
  if (override) {
    return path.resolve(override) === path.join(getConfigRoot(), 'agent');
  }
  return true;
}

/** XDG data root for the default agent dir: only honored on linux/darwin when
 *  $XDG_DATA_HOME/omp already exists — omp treats the XDG layout as opt-in via
 *  `omp config init-xdg`. XDG flattens the `agent/` prefix:
 *  ~/.omp/agent/sessions → $XDG_DATA_HOME/omp/sessions. */
function xdgDataAgentRoot(): string | undefined {
  if (process.platform !== 'linux' && process.platform !== 'darwin') return undefined;
  if (!isDefaultAgentDir()) return undefined;
  const value = Bun.env.XDG_DATA_HOME;
  if (!value) return undefined;
  try {
    const appRoot = path.join(value, APP_NAME);
    return existsSync(appRoot) ? appRoot : undefined;
  } catch {
    return undefined;
  }
}

function agentDataSubdir(subdir: string): string {
  const xdg = xdgDataAgentRoot();
  return path.join(xdg ?? getAgentDir(), subdir);
}

/** ~/.omp/agent/sessions (or $XDG_DATA_HOME/omp/sessions). */
export function getSessionsDir(): string {
  return agentDataSubdir('sessions');
}

/** ~/.omp/agent/projects.json — omp-web's managed-project registry. */
export function getProjectsRegistryPath(): string {
  return path.join(getAgentDir(), 'projects.json');
}

/**
 * The omp DATA root for user-scope plugin state.
 *
 * omp resolves `plugins/` and `marketplaces.json` through its `DirResolver`'s
 * `data` category (`getPluginsDir`/`getMarketplacesRegistryPath`), which is
 * `$XDG_DATA_HOME/omp` once `omp config init-xdg` has created it and `~/.omp`
 * otherwise. Reading `~/.omp/plugins` unconditionally would report an empty
 * plugin list on an XDG install — the same trap `agentDataSubdir` documents for
 * sessions. The condition is omp's own: the XDG app root must already EXIST, so
 * an unset-but-set XDG_DATA_HOME does not relocate anything.
 */
function pluginDataRoot(): string {
  if (process.platform !== 'linux' && process.platform !== 'darwin') return getConfigRoot();
  if (!isDefaultAgentDir()) return getConfigRoot();
  const value = Bun.env.XDG_DATA_HOME;
  if (!value) return getConfigRoot();
  try {
    const appRoot = path.join(value, APP_NAME);
    return existsSync(appRoot) ? appRoot : getConfigRoot();
  } catch {
    return getConfigRoot();
  }
}

/** User-scope plugin root: ~/.omp/plugins (or $XDG_DATA_HOME/omp/plugins). */
export function getPluginsDir(): string {
  return path.join(pluginDataRoot(), 'plugins');
}

/** ~/.omp/marketplaces.json — the configured marketplace catalogs. */
export function getMarketplacesRegistryPath(): string {
  return path.join(pluginDataRoot(), 'marketplaces.json');
}

/**
 * The project-scope plugin root for a cwd — a faithful port of omp's
 * `resolveOrDefaultProjectRegistryPath` (`discovery/helpers.ts`), which is the
 * single source of truth omp's own install/list/upgrade use.
 *
 * Two passes: the nearest ancestor holding `.omp/` wins, otherwise the nearest
 * ancestor holding `.git/`, otherwise the cwd itself. Both walks stop before
 * `$HOME`, because `~/.omp` is the USER config dir and treating it as a project
 * anchor would alias the two registries.
 */
export function getProjectPluginsDir(cwd: string): string {
  const home = homedir();
  const configDir = getConfigDirName();
  const root = path.resolve(cwd);
  for (const anchor of [configDir, '.git']) {
    let dir = root;
    while (dir !== home) {
      if (existsSync(path.join(dir, anchor))) return path.join(dir, configDir, 'plugins');
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return path.join(root, configDir, 'plugins');
}

/** Best-effort canonicalization (resolve symlinks when the path exists). */
export function canonicalize(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    return value;
  }
}

/**
 * True when a path exists — directory, file, or resolvable symlink. Use this
 * instead of `Bun.file(p).exists()`: that method answers for regular files and
 * FIFOs only and reports false for a directory that exists, so a directory
 * guard silently empties every scan behind it. That asymmetry is documented
 * (BunFile.exists: "returns true for regular files and FIFOs, false for
 * directories") and tracked as open bug oven-sh/bun#21537, unfixed as of
 * Bun 1.4.2 — so this is the standing behaviour to code against, not a
 * regression to wait out.
 *
 * `stat()` follows symlinks like `existsSync` and throws for missing or
 * dangling paths.
 */
export async function pathExists(target: string): Promise<boolean> {
  try {
    await Bun.file(target).stat();
    return true;
  } catch {
    return false;
  }
}

/**
 * Comparison key for a project path. Realpath resolution alone is not enough
 * to match two spellings of the same directory: macOS reports `/var/...` while
 * its realpath is `/private/var/...`, and a tombstone written before the path
 * existed keeps its unresolved form. Canonicalizing both sides plus a
 * trailing-separator strip makes the two forms comparable.
 */
export function projectPathKey(value: string): string {
  const canonical = canonicalize(value);
  const withoutTrailingSeparators = canonical.replace(/\/+$/, '');
  return withoutTrailingSeparators || canonical;
}

/**
 * Session directory slug for a cwd — faithful port of
 * getDefaultSessionDirName (oh-my-pi session-paths.ts):
 * - under $HOME: "-" + relative path with [/\:] replaced by dashes ("-" for $HOME itself)
 * - under tmpdir: "-tmp" (+ "-" + dashed relative path)
 * - otherwise: legacy absolute encoding "--abs-path-dashed--"
 */
export function getSessionDirNameForCwd(cwd: string): string {
  const canonicalCwd = canonicalize(path.resolve(cwd));
  const canonicalHome = canonicalize(homedir());
  const canonicalTmp = canonicalize(tmpdir());
  const homeRelative = path.relative(canonicalHome, canonicalCwd);
  const tempRelative = path.relative(canonicalTmp, canonicalCwd);
  if (homeRelative === '' || (!homeRelative.startsWith('..') && !path.isAbsolute(homeRelative))) {
    return encodeRelativeSessionDirName('-', homeRelative);
  }
  if (tempRelative === '' || (!tempRelative.startsWith('..') && !path.isAbsolute(tempRelative))) {
    return encodeRelativeSessionDirName('-tmp', tempRelative);
  }
  return encodeLegacyAbsoluteSessionDirName(canonicalCwd);
}

function encodeRelativeSessionDirName(prefix: string, relative: string): string {
  const encoded = relative.replace(/[/\\:]/g, '-');
  return encoded ? (prefix.endsWith('-') ? `${prefix}${encoded}` : `${prefix}-${encoded}`) : prefix;
}

function encodeLegacyAbsoluteSessionDirName(cwd: string): string {
  const resolvedCwd = path.resolve(cwd);
  return `--${resolvedCwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}
