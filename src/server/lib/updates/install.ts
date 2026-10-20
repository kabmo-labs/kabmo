/**
 * Kabmo self-update.
 *
 * Resolves the newest published release, works out how this copy was installed
 * (./install-method), then replaces it in place:
 *
 * - `bun-global` — `bun add -g kabmo@<version>`.
 * - `git` — fetch, fast-forward to the release tag, then `bun install` and a
 *   client rebuild (`dist/` is gitignored, so a source checkout must rebuild).
 *
 * `kabmo update` and the console's `POST /api/updates/apply` both run
 * through here, so the CLI and the web button can never drift apart.
 */

import { join as joinPath, resolve as resolvePath } from 'node:path';

import { resolveBunBin } from '@/server/lib/lifecycle/bun';
import { packageDir } from '@/server/lib/fs/package-root';
import { KABMO_PACKAGE, LEGACY_PACKAGE, resolveUpdatePackage } from '@/server/lib/updates/npm';
import { releaseTagUrl } from '@/server/lib/updates/release-url';
import {
  REPO_URL,
  detectInstallMethod,
  isManualMethod,
  manualUpdateCommand,
  type InstallMethod,
  type InstallMethodInfo,
} from '@/server/lib/updates/install-method';
import { isNewer } from '@/shared/lib/updates/semver';
import { copyAt, resolveInstalledCopy, type InstalledCopy } from '@/server/lib/updates/installed-cli';
import { runStep, runSync, tail, type UpdateStep } from '@/server/lib/updates/install-steps';

/**
 * Package root of the running copy — the directory holding its `package.json`.
 *
 * Resolved by walking up from this module, never by counting `..` segments: the
 * AOT bundle flattens every server module into `dist/client/index.js`, so a
 * fixed depth names a different directory in a published install than in a
 * checkout. `packageDir()` finds the real one in both.
 */
const DEFAULT_PKG_ROOT = packageDir();

export interface KabmoVersionInfo {
  /** Version on disk right now (`package.json`), null when unreadable. */
  current: string | null;
  /** Newest version published on npm, null when none could be resolved. */
  latest: string | null;
  /** The npm package `latest` came from — `kabmo` after the rename. */
  package: string | null;
  /** The installed package's name differs from the resolved one. */
  renamed: boolean;
  updateAvailable: boolean;
  error: string | null;
}

export interface InstallContext extends InstallMethodInfo {
  pkgRoot: string;
  gitRemote: string | null;
  /** Resolved Bun binary used for `bun add` / `bun install` / `bun run build`. */
  bunBin: string;
}

export interface UpdateOptions {
  /** Reinstall even when the installed version is already the latest. */
  force?: boolean;
  pkgRoot?: string;
  /** Receives command output as it arrives (the CLI streams it; the server does not). */
  onLine?: (chunk: string) => void;
  /** Receives a step label before the step runs. */
  onStage?: (label: string) => void;
}

export interface KabmoUpdateResult {
  success: boolean;
  /** The environment cannot self-update; `message` holds the command to run. */
  manual: boolean;
  /** Files were actually replaced by this call. */
  updated: boolean;
  method: InstallMethod;
  reason: string;
  current: string | null;
  latest: string | null;
  /** The npm package this update installed from (`kabmo` after the rename). */
  package: string | null;
  /** The version this call targeted. */
  version: string | null;
  message: string;
  /** That version's npm page. */
  releaseUrl: string | null;
  /** Captured command output (tail), for non-streaming callers. */
  output: string;
  /**
   * The copy that now sits on disk — what a restart must launch.
   *
   * Not the copy that is RUNNING: a rename installs a different package
   * beside it, so respawning from the running directory relaunches the build
   * the update just replaced (measured on the 4.23.1 → 0.0.1 move).
   */
  installed: InstalledCopy | null;
}

/** Version installed on disk — not the one the running process imported. */
export async function readInstalledVersion(pkgRoot = DEFAULT_PKG_ROOT): Promise<string | null> {
  try {
    const pkg = (await Bun.file(joinPath(resolvePath(pkgRoot), 'package.json')).json()) as { version?: unknown };
    return typeof pkg?.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

/** Package name installed on disk — `ompchamber` on a pre-rename install, `kabmo` after. */
export async function readInstalledPackageName(pkgRoot = DEFAULT_PKG_ROOT): Promise<string | null> {
  try {
    const pkg = (await Bun.file(joinPath(resolvePath(pkgRoot), 'package.json')).json()) as { name?: unknown };
    return typeof pkg?.name === 'string' && pkg.name.length > 0 ? pkg.name : null;
  } catch {
    return null;
  }
}

/**
 * Installed version + newest published version on npm, never throws.
 *
 * The comparison is against npm rather than the GitHub release list because npm
 * is what the install comes from: `bun add -g kabmo@<version>` can only
 * install a published version, and a release tag that never reached the registry
 * would be offered and then fail to install.
 */
export async function resolveKabmoVersion(pkgRoot = DEFAULT_PKG_ROOT): Promise<KabmoVersionInfo> {
  const current = await readInstalledVersion(pkgRoot);
  const installedName = await readInstalledPackageName(pkgRoot);
  const target = await resolveUpdatePackage(installedName);
  // A rename is an update even when its version is LOWER: the product restarts
  // at 0.0.1, so semver would compare 4.23.0 against 0.0.1 and offer nothing.
  // Specifically OLD → NEW — an install on the current name is never "renamed".
  const renamed = Boolean(installedName === LEGACY_PACKAGE && target.name === KABMO_PACKAGE && target.latest);
  return {
    current,
    latest: target.latest,
    package: target.latest ? target.name : null,
    renamed,
    updateAvailable: renamed || Boolean(current && target.latest && isNewer(target.latest, current)),
    error: target.latest ? null : 'No Kabmo release could be resolved',
  };
}

/** Which install this is, plus the git facts and Bun binary the steps need. */
export function resolveInstallContext(pkgRoot = DEFAULT_PKG_ROOT): InstallContext {
  // Callers pass a path built with `..` segments (CLI/`import.meta.dir`), and
  // these strings end up in user-facing messages and git arguments.
  const root = resolvePath(pkgRoot);
  const inside = runSync(['git', '-C', root, 'rev-parse', '--is-inside-work-tree']);
  const gitWorkTree = inside.ok && inside.out === 'true';
  const remote = gitWorkTree ? runSync(['git', '-C', root, 'remote', 'get-url', 'origin']) : null;
  const gitRemote = remote?.ok && remote.out.length > 0 ? remote.out : null;

  return {
    ...detectInstallMethod({ pkgRoot: root, gitWorkTree, gitRemote }),
    pkgRoot: root,
    gitRemote,
    bunBin: resolveBunBin(),
  };
}

/** The commands that install `version` for a given install method. */
export function planUpdateSteps({ method, version, pkgRoot, bunBin, packageName = KABMO_PACKAGE }: { method: InstallMethod; version: string; pkgRoot: string; bunBin: string; packageName?: string }): UpdateStep[] {
  if (method === 'bun-global') {
    return [
      {
        label: `Installing ${packageName}@${version}`,
        cmd: [bunBin, 'add', '-g', `${packageName}@${version}`],
        cwd: pkgRoot,
      },
    ];
  }

  return [
    { label: 'Fetching release tags', cmd: ['git', '-C', pkgRoot, 'fetch', '--tags', 'origin'], cwd: pkgRoot },
    { label: `Fast-forwarding to v${version}`, cmd: ['git', '-C', pkgRoot, 'merge', '--ff-only', `v${version}`], cwd: pkgRoot },
    { label: 'Installing dependencies', cmd: [bunBin, 'install'], cwd: pkgRoot },
    { label: 'Building the client bundle', cmd: [bunBin, 'run', 'build'], cwd: pkgRoot },
  ];
}

/**
 * Bring this install to the newest release. Never throws: every failure mode
 * (no release, unsupported install, dirty work tree, failing step) comes back
 * as `success: false` with a message the CLI can print and the console can
 * show verbatim.
 */
export async function updateKabmo({ force = false, pkgRoot = DEFAULT_PKG_ROOT, onLine, onStage }: UpdateOptions = {}): Promise<KabmoUpdateResult> {
  const context = resolveInstallContext(pkgRoot);
  const root = context.pkgRoot;
  const base = {
    manual: false,
    updated: false,
    method: context.method,
    reason: context.reason,
    current: null,
    latest: null,
    package: null,
    version: null,
    releaseUrl: null,
    output: '',
    installed: null,
  } satisfies Omit<KabmoUpdateResult, 'success' | 'message'>;
  const fail = (message: string, patch: Partial<KabmoUpdateResult> = {}): KabmoUpdateResult => ({
    success: false,
    ...base,
    message,
    ...patch,
  });

  let info: KabmoVersionInfo;
  try {
    info = await resolveKabmoVersion(root);
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Failed to resolve the latest release');
  }

  const resolved = { current: info.current, latest: info.latest, package: info.package, releaseUrl: info.latest ? releaseTagUrl(info.latest) : null };

  if (!info.latest) {
    return fail(info.error ?? 'No Kabmo release could be resolved', resolved);
  }

  if (!info.updateAvailable && !force && info.current) {
    return {
      success: true,
      ...base,
      ...resolved,
      version: info.latest,
      message: `Kabmo ${info.current} is already up to date.`,
    };
  }

  if (context.method === 'git' && info.renamed) {
    // A new repository has unrelated history, so there is no tag to fast-forward
    // to. Re-cloning is the only safe move: `reset --hard` would discard local
    // commits a clean work tree can still hold.
    return fail(
      `This checkout predates the rename to ${info.package}. Re-clone it: git clone ${REPO_URL}`,
      { ...resolved, manual: true, version: info.latest },
    );
  }

  if (isManualMethod(context.method)) {
    return fail(`This copy (${context.reason}) cannot update itself. Run: ${manualUpdateCommand(context.method, info.latest, info.package ?? KABMO_PACKAGE)}`, { ...resolved, manual: true, version: info.latest });
  }

  if (context.method === 'git') {
    // Uncommitted work in the checkout: never merge over it.
    const dirty = runSync(['git', '-C', root, 'status', '--porcelain']);
    if (dirty.ok && dirty.out.length > 0) {
      return fail(`Uncommitted changes in ${root}. Commit or stash them, then update again.`, { ...resolved, manual: true, version: info.latest });
    }
  }

  const collected: string[] = [];
  for (const step of planUpdateSteps({ method: context.method, version: info.latest, pkgRoot: root, bunBin: context.bunBin, packageName: info.package ?? KABMO_PACKAGE })) {
    onStage?.(step.label);

    let stepResult: { ok: boolean; exitCode: number | null; output: string };
    try {
      stepResult = await runStep(step, onLine);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return fail(`${step.cmd[0]} could not be started: ${detail}`, { ...resolved, version: info.latest, output: tail(collected.join('\n\n')) });
    }

    if (stepResult.output.length > 0) collected.push(stepResult.output);

    if (!stepResult.ok) {
      return fail(`\`${step.cmd.join(' ')}\` failed with exit code ${stepResult.exitCode ?? 'unknown'}.`, {
        ...resolved,
        version: info.latest,
        output: tail(collected.join('\n\n')),
      });
    }
  }

  // Read back AFTER the steps: a global install puts the package where the
  // installer decided, and a checkout IS the package. A null here leaves the
  // restart on this process's own copy, which is the honest fallback.
  const installed = context.method === 'git'
    ? copyAt(root)
    : resolveInstalledCopy(info.package ?? KABMO_PACKAGE, context.bunBin) ?? copyAt(root);

  return {
    success: true,
    ...base,
    ...resolved,
    installed,
    updated: true,
    version: info.latest,
    message: info.renamed
      ? `Switched to ${info.package} v${info.latest} (${context.method}).`
      : `Kabmo updated to v${info.latest} (${context.method}).`,
    output: tail(collected.join('\n\n')),
  };
}
