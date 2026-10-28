/**
 * Server-side helper for resolving the "scoped root" the right-panel developer
 * tools (Files / Search / Git / Terminal) operate on.
 *
 * A session row belongs to a workspace folder; when that folder is bound to an
 * oh-my-pi project (project_path), selecting one of its sessions should make
 * every right panel work inside that real project directory instead of the
 * kabmo app directory. This module keeps that opt-in capability safe:
 * arbitrary client paths are rejected — a root is only honored when it is the
 * app root, a directory below it, or an exact registered workspace project
 * path from the SQLite database.
 */

import path from 'path';
import { getDb } from '@/server/db.server';
import { pathExists } from '@/server/lib/omp/core/paths';
import { canonicalPath } from '@/server/lib/fs/canonical';
import { externalRoots, isExternalRoot } from '@/server/lib/fs/external-roots';
import { resolveProjectRoot } from '@/server/lib/omp/core/worktree';

const APP_ROOT = process.cwd();

/** True when `target` is `root` itself or a path nested beneath it. */
export function isWithinRoot(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

/** Resolve `rel` under `root`; null when the result escapes the root. */
export function resolveWithinRoot(root: string, rel: string): string | null {
  const target = path.resolve(root, rel);
  return isWithinRoot(root, target) ? target : null;
}

/**
 * Resolve a file a drop or a link pointed at, which may live outside the active
 * root.
 *
 * A dropped file is always named by an absolute path or URL — a file manager
 * cannot know which workspace the page considers active — so
 * {@link resolveWithinRoot} rejects exactly the references the composer needs.
 * The allow-list that governs a client-supplied `root` governs these too: the
 * app root, a path beneath it, or an exact registered workspace project path.
 * Anything else resolves to null, so an arbitrary path from a page still cannot
 * read the filesystem.
 */
export async function resolveReferencedPath(rawPath: string): Promise<string | null> {
  const candidate = rawPath.trim();
  if (!candidate) return null;

  const resolved = path.resolve(candidate);
  if (resolved === APP_ROOT || resolved.startsWith(APP_ROOT + path.sep)) {
    return (await pathExists(resolved)) ? resolved : null;
  }

  // A directory the user dropped a file from (see `external-roots.ts`).
  if (isExternalRoot(path.dirname(resolved)) && (await pathExists(resolved))) return resolved;

  try {
    const db = await getDb();
    const rows = (await db.all(
      'SELECT project_path FROM workspace_folders WHERE project_path IS NOT NULL'
    )) as { project_path: string }[];
    for (const row of rows) {
      const workspaceRoot = path.resolve(row.project_path);
      if (isWithinRoot(workspaceRoot, resolved) && (await pathExists(resolved))) return resolved;
    }
  } catch {
    // Database unavailable — nothing outside the app root can be verified.
  }

  return null;
}

/**
 * The scope an absolute path should be opened under, or null when it is not
 * inside anything Kabmo is allowed to read.
 *
 * The reverse direction of {@link resolveWithinRoot}: that one takes a client
 * `root` + relative path, this one is handed a path a DROP produced — which is
 * always absolute, because a file manager cannot know which workspace the page
 * considers active. The allow-list is the same one, so the two cannot disagree
 * about what is readable.
 *
 * The DEEPEST matching root wins, so a nested registered workspace answers for
 * its own files rather than having the app root claim them (which would produce
 * a relative path like `packages/app/src/x.ts` that no panel is scoped to).
 */
export async function resolveScopeForAbsolutePath(rawPath: string): Promise<{ root: string; path: string } | null> {
  const candidate = rawPath.trim();
  if (!candidate) return null;

  const resolved = path.resolve(candidate);
  const roots: string[] = [];

  if (isWithinRoot(APP_ROOT, resolved)) roots.push(APP_ROOT);
  // A dropped file's own directory, granted by the gesture that dropped it.
  for (const granted of externalRoots()) {
    if (isWithinRoot(granted, resolved)) roots.push(granted);
  }

  try {
    const db = await getDb();
    const rows = (await db.all(
      'SELECT project_path FROM workspace_folders WHERE project_path IS NOT NULL'
    )) as { project_path: string }[];
    for (const row of rows) {
      const workspaceRoot = path.resolve(row.project_path);
      if (isWithinRoot(workspaceRoot, resolved)) roots.push(workspaceRoot);
    }
  } catch {
    // Database unavailable — only the app root can be verified.
  }

  if (roots.length === 0) return null;
  // Longest first: a nested workspace beats the directory that contains it.
  const root = roots.sort((a, b) => b.length - a.length)[0];
  return { root, path: path.relative(root, resolved).split(path.sep).join('/') };
}

/**
 * Default browsing root when no session-bound project is active. Mock/demo
 * mode browses the bundled `examples` tree; real mode browses the app root.
 */
export async function getDefaultFsRoot(mock: boolean): Promise<string> {
  if (mock) {
    const examplesDir = path.join(APP_ROOT, 'examples');
    if (await pathExists(examplesDir)) return examplesDir;
  }
  return APP_ROOT;
}

/**
 * Resolve a client-supplied `root` (query param or form field) to a directory
 * the server is allowed to operate on.
 *
 * Returns `fallback` when `rawRoot` is missing, does not exist, or is not on
 * the allow-list (app root / subpath / registered project_path / **worktree of
 * a registered project**), so existing callers keep their previous behavior for
 * unscoped requests.
 *
 * The worktree branch is why a worktree session's panels can point anywhere:
 * a chat started in a linked checkout runs there, and `resolveRoot` answered the
 * fallback for it — measured, so Files/Search/Git/Terminal silently showed the
 * app root while the agent wrote to the worktree. The rule is deliberately
 * narrow: the candidate's own REPOSITORY ROOT must be a registered project, so a
 * registered project never becomes a filesystem grant. A SUBDIRECTORY is still
 * refused — the allow-list stays exact roots, and a panel is pointed at the
 * worktree root, never at a folder inside it.
 */
export async function resolveRoot(
  rawRoot: string | null | undefined,
  fallback: string
): Promise<string> {
  if (!rawRoot || !rawRoot.trim()) return fallback;

  const resolved = path.resolve(rawRoot.trim());
  if (!(await pathExists(resolved))) return fallback;

  // Fast path: the app root and anything beneath it are always allowed.
  if (resolved === APP_ROOT || resolved.startsWith(APP_ROOT + path.sep)) {
    return resolved;
  }

  // A directory the user DROPPED a file from. `external-roots.ts` holds the
  // rules; the gesture is what created it, and it is checked before the
  // database because a drop outside every workspace is the case this exists
  // for — the DB read would be a round trip that always answers no.
  if (isExternalRoot(resolved)) return resolved;

  // Registered workspaces are user-opted project roots — allow exact matches,
  // compared by canonical path so a `/tmp` vs `/private/tmp` spelling of one
  // directory is not read as two.
  try {
    const db = await getDb();
    const rows = (await db.all(
      'SELECT project_path FROM workspace_folders WHERE project_path IS NOT NULL'
    )) as { project_path: string }[];
    const canonical = await canonicalPath(resolved);
    for (const row of rows) {
      if ((await canonicalPath(row.project_path)) === canonical) return resolved;
    }

    // A worktree ROOT: `resolveProjectRoot` only asks git when the candidate
    // holds a `.git` entry, so a linked checkout resolves to the main repository
    // while an ordinary subdirectory resolves to ITSELF and stays refused. That
    // is what keeps this rule at "the roots of registered repositories" instead
    // of "anything beneath one".
    if (rows.length > 0) {
      const projectRoot = await canonicalPath(await resolveProjectRoot(resolved));
      for (const row of rows) {
        if ((await canonicalPath(row.project_path)) === projectRoot) return resolved;
      }
    }
  } catch {
    // Database or git unavailable — fall through to the safe fallback.
  }

  return fallback;
}
