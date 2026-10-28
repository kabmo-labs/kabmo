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

import { Chunk, diff } from '@codemirror/merge';
import { Text } from '@codemirror/state';

/**
 * Additions and deletions, counted from the SAME line-level diff the view draws.
 *
 * `Chunk.build` is the merge view's own chunking — a line-level diff, which is
 * what its rows are. `diff()` would be the wrong source here: it is a
 * CHARACTER diff, so changing `line 5` into `line 5 changed` reports one
 * insertion of `" changed"` and no deletion at all, and the badge would claim
 * two additions for two edited lines.
 */
export function countChanges(original: string, next: string): { additions: number; deletions: number } {
  const a = Text.of(original.split('\n'));
  const b = Text.of(next.split('\n'));
  let additions = 0;
  let deletions = 0;
  for (const chunk of Chunk.build(a, b)) {
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
