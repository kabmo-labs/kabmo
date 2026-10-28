/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pure label helpers behind a tool card's facts: durations, byte sizes,
 * excerpt-diff counts, count phrases.
 *
 * Split out of `summary.ts` so that module stays inside the repo's per-file
 * ceiling — it owns the per-tool FACT DERIVATION, which is the part worth
 * reading in one piece, while these are formatting rules with no domain
 * knowledge.
 */

/** `28ms` / `1.2s` / `2m 3s` — the scale a tool call actually lives on. */
export function formatToolMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const totalSeconds = Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

/** `4.6 KB` / `2.0 MB` — byte sizes are shortened, never raw counts. */
export function formatToolBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Count the `+`/`-` rows of an omp excerpt diff (`-43|` / `+43|`). */
export function excerptDiffCounts(diff: string): { added: number; removed: number } | null {
  let added = 0;
  let removed = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  return added + removed > 0 ? { added, removed } : null;
}

/** `+4 −1` with a real minus sign, so it cannot be read as a hyphen. */
export function diffLabel(added: number, removed: number): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`+${added}`);
  if (removed > 0) parts.push(`\u2212${removed}`);
  return parts.join(' ');
}

/** `12 matches in 3 files` / `3 files` — one count phrase for both shapes.
 *  The plural is explicit: an `s` suffix would render `2 matchs`. */
export function countPhrase(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
