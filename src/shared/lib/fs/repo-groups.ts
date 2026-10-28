/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How a flat list of repositories is grouped for the repo management modal.
 *
 * Discovery returns a flat list — `.` for the workspace root itself, then one
 * entry per nested repository (`projects/jns6_5/token`) — and a flat list of
 * fifty rows is exactly what the modal exists to make navigable. The grouping
 * is the same one a reader already has in their head from the file tree: the
 * workspace root, then one group per top-level directory.
 *
 * **Sorted, never in discovery order.** `findGitDirs` pushes entries in
 * `readdir` order, which is filesystem order and differs between machines and
 * after a directory is written; a list that reorders itself between two reads of
 * the same workspace is a list nobody can scan. Paths sort with the same
 * comparison a file listing uses.
 *
 * A single-segment repo (`token`) has no folder to group under, so it belongs to
 * the root group — it IS a direct child of the workspace, which is what the
 * group means.
 */

export interface RepoGroup {
  /** Stable key for React; `''` is the workspace root's own group. */
  key: string;
  /** Heading text; `null` for the root group, which needs no heading. */
  label: string | null;
  /** Root-relative paths, sorted. */
  paths: string[];
}

/**
 * Group repos by their first path segment, root first.
 *
 * `rootIsRepo` decides whether `.` gets the root group to itself or is grouped
 * with the direct children: when the workspace root IS a repository, its row is
 * the one the panels default to and it leads the list on its own; when it is
 * not (a folder of nested repos), a `.` row would be a row git cannot read and
 * discovery does not produce one.
 */
export function groupRepos(repos: readonly string[]): RepoGroup[] {
  const groups = new Map<string, RepoGroup>();

  for (const repo of repos) {
    if (!repo || repo === '.') {
      if (!groups.has('')) groups.set('', { key: '', label: null, paths: [] });
      groups.get('')!.paths.push('.');
      continue;
    }
    const slash = repo.indexOf('/');
    const key = slash === -1 ? '' : repo.slice(0, slash);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: key === '' ? null : key, paths: [] };
      groups.set(key, group);
    }
    group.paths.push(repo);
  }

  for (const group of groups.values()) {
    group.paths.sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b)));
  }

  // Root group first, then folders alphabetically. The root is the repository
  // the panels are most likely showing and the one a reader looks for first.
  return [...groups.values()].sort((a, b) => {
    if (a.key === '') return -1;
    if (b.key === '') return 1;
    return a.key.localeCompare(b.key);
  });
}

/**
 * The name a row is listed under inside its group: the part below the group
 * heading, so `projects/jns6_5/token` under `projects` reads `jns6_5/token`
 * rather than repeating the folder it is already filed under.
 */
export function repoNameWithinGroup(path: string, groupKey: string): string {
  if (path === '.') return 'workspace root';
  if (groupKey === '') return path;
  return path.slice(groupKey.length + 1);
}
