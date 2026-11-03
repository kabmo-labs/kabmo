/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What the diff toolbar's badge counts, and what the whitespace toggle folds.
 *
 * Split out of `merge.ts` for the per-file ceiling, and the two belong together:
 * both answer "what counts as a change" and they must answer it the SAME way.
 * A badge that counted a whitespace change the toggle had hidden would be a
 * number describing rows that are not on screen.
 */

import { diff, type Chunk } from '@codemirror/merge';
import type { Text } from '@codemirror/state';

/**
 * Additions and deletions of a chunk list, against the two documents it
 * describes.
 *
 * The chunks come from the MERGE VIEW, never from a second `Chunk.build` of the
 * same pair. That second build was the panel's slowest step and its only
 * disagreement with itself, because it ran with NO diff config: the view builds
 * its chunks with `defaultDiffConfig` (`scanLimit: 500`, so a large file falls
 * back to a coarse match) while a bare `Chunk.build` scans without a limit.
 * Measured on a 27 000-line pair of which 540 lines changed:
 *
 * - the badge's own diff took **4.0 s** of main thread and reported **540**
 *   additions/deletions;
 * - the rows on screen reported **26 951** — the view's coarse fallback — so the
 *   badge described a diff the reader was not looking at, which is the one thing
 *   this module must never do.
 *
 * On a fully rewritten file the unconfigured scan is far worse: 3.4 s at 500
 * lines, 14.5 s at 1 000, 55 s at 2 000, all still one chunk. `diff()` would be
 * the wrong source even as a shortcut: it is a CHARACTER diff, so changing
 * `line 5` into `line 5 changed` reports one insertion of `" changed"` and no
 * deletion at all.
 */
export function countChunks(
  a: Text,
  b: Text,
  chunks: readonly Chunk[],
): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const chunk of chunks) {
    // `endA`/`endB` are the end of the chunk's last line, and equal the start
    // when the chunk covers no lines on that side (a pure insertion/deletion).
    if (chunk.endA > chunk.fromA) deletions += a.lineAt(chunk.endA).number - a.lineAt(chunk.fromA).number + 1;
    if (chunk.endB > chunk.fromB) additions += b.lineAt(chunk.endB).number - b.lineAt(chunk.fromB).number + 1;
  }
  return { additions, deletions };
}

/**
 * `original` with every whitespace-only change replaced by the new text.
 *
 * The toolbar's whitespace toggle means "do not show me formatting noise", and
 * the merge view compares DOCUMENTS — so the way to honour it is to make the two
 * sides agree there. The old table parser folded a `-`/`+` pair whose trimmed
 * text matched back into a context row; this does the same at the source, which
 * is why the toggle changes the CHUNKS rather than only their colour.
 *
 * Only line-for-line changes are folded: an inserted or deleted line is a real
 * change even when it is blank, and hiding it would make the file's line count
 * disagree with what is on screen.
 */
export function foldWhitespaceOnly(original: string, next: string): string {
  const changes = diff(original, next);
  let folded = original;
  // Back to front: an earlier splice would move every later offset.
  for (let index = changes.length - 1; index >= 0; index--) {
    const change = changes[index];
    const before = original.slice(change.fromA, change.toA);
    const after = next.slice(change.fromB, change.toB);
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    if (beforeLines.length !== afterLines.length) continue;
    if (!beforeLines.every((line, lineIndex) => line.trim() === afterLines[lineIndex].trim())) continue;
    folded = folded.slice(0, change.fromA) + after + folded.slice(change.toA);
  }
  return folded;
}
