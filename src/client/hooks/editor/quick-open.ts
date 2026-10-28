/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Quick open: reach a file by NAME, without expanding the tree.
 *
 * `⌘P` is the fastest route to a file the reader has not opened — the tree needs
 * every folder on the path expanded, and a search panel needs a query about the
 * file's CONTENT. The index is `/api/fs/list`, which already exists for the
 * composer's `@` picker: a flat walk, capped at 3 000 files, skipping the
 * dependency trees (`node_modules`, `dist`, …). That budget is exactly what a picker
 * wants, so this reuses the route rather than growing a second one.
 *
 * ## Matching is per-SEGMENT, not a substring of the whole path
 *
 * `useTabs` finds `use-file-tabs.ts`; so does `uft`; and so does `tabs`. What a
 * user types is usually the tail of a path, and a plain `path.includes(query)` ranks
 * `src/client/hooks/editor/use-file-tabs.ts` no better than a file whose directory
 * happens to contain the same letters. Scoring prefers, in order: an exact basename
 * match, a basename prefix, a basename substring, then the same three against the
 * whole path — and shorter paths win ties, because the file you want is usually the
 * one closest to the root of what you typed.
 */

/** One file the picker can offer. */
export interface QuickOpenEntry {
  /** Workspace-relative path — what `handleOpenFile` takes. */
  path: string;
  /** The last segment, for the row's title. */
  name: string;
  /** Everything before the last segment, for the row's subtitle. */
  directory: string;
}

/** The shape `/api/fs/list` answers. */
interface FileListResponse {
  files?: unknown;
  truncated?: unknown;
}

/** A row from `/api/fs/list`, narrowed rather than asserted. */
function isFileRow(value: unknown): value is { path: string } {
  return typeof value === 'object' && value !== null && 'path' in value && typeof value.path === 'string';
}

/** Split a workspace-relative path into the two parts a row prints. */
export function quickOpenEntry(path: string): QuickOpenEntry {
  const cut = path.lastIndexOf('/');
  return cut === -1
    ? { path, name: path, directory: '' }
    : { path, name: path.slice(cut + 1), directory: path.slice(0, cut) };
}

/**
 * A score for one entry against a query, or `null` when it does not match.
 *
 * Higher is better. The tiers are ordered so that a basename hit ALWAYS beats a
 * directory-only hit, which is what makes typing a file's name find the file rather
 * than every sibling in a folder named after it.
 */
export function scoreQuickOpen(entry: QuickOpenEntry, query: string): number | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  const name = entry.name.toLowerCase();
  const path = entry.path.toLowerCase();

  const tier = (haystack: string, weight: number): number | null => {
    if (haystack === needle) return weight + 300;
    if (haystack.startsWith(needle)) return weight + 200;
    if (haystack.includes(needle)) return weight + 100;
    return null;
  };

  const nameScore = tier(name, 1000);
  if (nameScore !== null) return nameScore - entry.path.length / 100;
  const pathScore = tier(path, 0);
  if (pathScore !== null) return pathScore - entry.path.length / 100;
  // A subsequence match (`uft` → use-file-tabs) is the last resort, and only on the
  // basename: a subsequence over a whole path matches almost everything.
  if (isSubsequence(needle, name)) return 50 - entry.path.length / 100;
  return null;
}

/** Whether every character of `needle` appears in `haystack`, in order. */
export function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

/** The ranked matches for `query`, best first, capped at `limit`. */
export function rankQuickOpen(
  entries: readonly QuickOpenEntry[],
  query: string,
  limit = 50,
): QuickOpenEntry[] {
  const scored: Array<{ entry: QuickOpenEntry; score: number }> = [];
  for (const entry of entries) {
    const score = scoreQuickOpen(entry, query);
    if (score !== null) scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path));
  return scored.slice(0, limit).map((row) => row.entry);
}

/** Read the index for one scope. A refusal answers an empty list, never a throw. */
export async function fetchQuickOpenIndex(root?: string | null, repo?: string | null): Promise<QuickOpenEntry[]> {
  const params = new URLSearchParams();
  if (root) params.set('root', root);
  if (repo && repo !== '.') params.set('repo', repo);
  try {
    const res = await fetch(`/api/fs/list?${params.toString()}`);
    const data = (await res.json().catch(() => null)) as FileListResponse | null;
    if (!res.ok || !data || !Array.isArray(data.files)) return [];
    return data.files.flatMap((row) => {
      if (!isFileRow(row)) return [];
      return row.path ? [quickOpenEntry(row.path)] : [];
    });
  } catch {
    return [];
  }
}
