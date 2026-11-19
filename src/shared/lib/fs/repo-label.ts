/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How a repository is NAMED on screen.
 *
 * A repo is a path relative to the workspace root — `projects/jns6_5/token`
 * only means something next to `~/JatisMobile/Workspace` — so every surface
 * that shows one has to answer two questions the same way: what the root itself
 * is called (`.`, which has no name of its own) and how much of the path fits.
 *
 * Three call sites needed this and two of them had written it out separately
 * (the shared repo dropdown and the git panel's header), which is how a picker
 * comes to label one repo two ways. The root's name comes from its path's last
 * segment, which is the one word a user recognizes: `~/JatisMobile/Workspace`
 * is "Workspace".
 */

/**
 * The workspace root's own name: its last path segment.
 *
 * `~/JatisMobile/Workspace` → `Workspace`. Trailing separators are dropped
 * first, so `…/Workspace/` names the same thing, and a path that is nothing but
 * separators (`/`) has no name — the literal "workspace root" is the honest
 * answer there rather than an empty label.
 */
export function workspaceFolderName(rootPath: string | undefined): string {
  if (!rootPath) return 'workspace root';
  const parts = rootPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : 'workspace root';
}

/**
 * The full label of a repo in a list: `.` reads as the workspace root's name,
 * anything else as its own root-relative path.
 *
 * The path is kept whole (not truncated to its basename) because the list is
 * where the difference between `jns6_5/token` and `jns7/token` has to be
 * visible — the same reason the branch modal lists whole branch names.
 */
export function repoLabel(repo: string, rootPath: string | undefined): string {
  return repo === '.' ? workspaceFolderName(rootPath) : repo;
}

/**
 * The label for a trigger button, where the space is a few characters wide: a
 * nested repo is named by its last segment only (`projects/jns6_5/token` →
 * `token`), and the root by the root's own name.
 */
export function repoShortLabel(repo: string, rootPath: string | undefined): string {
  if (repo === '.') return workspaceFolderName(rootPath);
  return repo.split('/').pop() || repo;
}

/** One choice a repo picker draws: the path it sends back, and its two labels. */
export interface RepoRow {
  repo: string;
  label: string;
  short: string;
}

/**
 * The rows a repo picker draws: the workspace root first, then discovery's
 * order.
 *
 * The root is a legitimate choice even when it is not itself a repository — a
 * folder of nested repos is a normal workspace, and Files/Search/Terminal browse
 * it — so the row is SYNTHESIZED when discovery did not report it. Discovery
 * omits `'.'` for a root that is not a repo (the git route's implicit-repo
 * fallback depends on that), and a picker that mapped the list straight through
 * therefore lost the root the moment the walk found a nested repo: the trigger
 * fell back to the first nested repo while the panel was still browsing the
 * root.
 */
export function repoRows(rootPath: string | undefined, repos: readonly string[]): RepoRow[] {
  const rest = repos.filter((repo) => repo !== '.');
  return ['.', ...rest].map((repo) => ({
    repo,
    label: repoLabel(repo, rootPath),
    short: repoShortLabel(repo, rootPath),
  }));
}
