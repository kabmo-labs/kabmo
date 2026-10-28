/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The tab id an `omp:open-file` payload resolves to when the caller supplies
 * none. Extracted so the diff→editor conversion can produce the *same* id a
 * later `omp:open-file` for that path would: the two paths must dedupe onto one
 * tab, and a second scheme would leave two tabs for one file.
 */
export function fileTabId(path: string): number {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = (hash << 5) - hash + path.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || Date.now();
}

/** The diff tab id for a path: staged and unstaged diffs are separate tabs. */
export function diffTabId(path: string, staged: boolean): string {
  return `diff-${staged ? 'staged' : 'working'}-${path}`;
}

/** Display name for a diff tab: `main.ts` → `main.ts (Diff)`. */
export function diffTabName(path: string): string {
  return `${path.split('/').pop() || path} (Diff)`;
}
