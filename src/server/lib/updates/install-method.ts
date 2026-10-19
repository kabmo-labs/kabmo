/**
 * How this Kabmo copy was put on disk, and therefore how it can replace
 * itself. Detection is pure path/flag inspection so the branch table stays
 * unit-testable: the caller supplies the one fact that needs a subprocess
 * (whether `pkgRoot` is a git work tree, and where its `origin` points).
 */

import { KABMO_PACKAGE } from '@/server/lib/updates/npm';

/** Where the running copy came from. */
export type InstallMethod = 'bun-global' | 'git' | 'npm' | 'unmanaged';

export interface InstallMethodInfo {
  method: InstallMethod;
  /** Why this method was chosen — surfaced in CLI/JSON diagnostics. */
  reason: string;
}

export interface DetectInstallInput {
  /** Package root: the directory holding the `package.json` being executed. */
  pkgRoot: string;
  /** `git -C <pkgRoot> rev-parse --is-inside-work-tree` returned `true`. */
  gitWorkTree: boolean;
  /** `git -C <pkgRoot> remote get-url origin`, or null when there is no origin. */
  gitRemote?: string | null;
}

/** Kabmo's own repository — only its checkout can fast-forward to a release tag. */
export const REPO_URL = 'https://github.com/kabmo-labs/kabmo.git';

/** The pre-rename repository; a checkout of either is recognized as updatable. */
export const LEGACY_REPO_URL = 'https://github.com/rajebdev/ompchamber.git';

// Bun's global install layout, independent of where BUN_INSTALL points.
const BUN_GLOBAL = /(^|\/)install\/global\/node_modules\//;
// Any other package-manager layout: npm/pnpm/yarn global, or a project dependency.
const NODE_MODULES = /(^|\/)node_modules\//;
// A remote that IS the repository (https, git@host:owner/name, trailing .git).
// Both spellings are accepted: a checkout created before the rename keeps the
// old remote URL (GitHub redirects it), and it must stay fast-forwardable.
const REPO_REMOTE = /(^|[/:])(ompchamber|kabmo)(\.git)?$/;

export function detectInstallMethod({ pkgRoot, gitWorkTree, gitRemote }: DetectInstallInput): InstallMethodInfo {
  // Windows separators are normalized so one branch table covers both platforms.
  const root = String(pkgRoot ?? '').replace(/\\/g, '/');

  if (BUN_GLOBAL.test(root)) {
    return { method: 'bun-global', reason: 'bun global install' };
  }

  if (NODE_MODULES.test(root)) {
    return { method: 'npm', reason: 'package-manager install under node_modules' };
  }

  if (gitWorkTree && REPO_REMOTE.test(String(gitRemote ?? '').replace(/\\/g, '/'))) {
    return { method: 'git', reason: 'git checkout of Kabmo repository' };
  }

  if (gitWorkTree) {
    return { method: 'unmanaged', reason: `git checkout tracking ${gitRemote ?? 'no origin'}` };
  }

  return { method: 'unmanaged', reason: 'source copy with no git metadata' };
}

/**
 * True when the CLI/server cannot replace the files itself: a package-manager
 * install is owned by its manager, and an unmanaged copy has no update source.
 */
export function isManualMethod(method: InstallMethod): boolean {
  return method === 'npm' || method === 'unmanaged';
}

/**
 * The exact command a user must run when the update cannot be automatic.
 *
 * Both branches use `bun add -g`: Kabmo is a Bun package and the repo's own
 * toolchain contract is Bun-only (see AGENTS.md — npm/npx/yarn/pnpm are never
 * used here), so a copy under `node_modules` is still replaced with `bun`, not
 * with the package manager that happened to install it. The method is reported
 * separately for diagnostics; it does not change the command.
 */
export function manualUpdateCommand(method: InstallMethod, version: string | null, packageName = KABMO_PACKAGE): string | null {
  if (method === 'unmanaged' || method === 'npm') return `bun add -g ${packageName}@${version ?? 'latest'}`;
  return null;
}
