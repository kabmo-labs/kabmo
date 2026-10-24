/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A unified patch as its two DOCUMENTS.
 *
 * This replaced a table parser (`diff-parser.ts`) that produced per-row line
 * numbers and paired split-view rows. Both of those are now the merge view's
 * job — `@codemirror/merge` computes the alignment itself from two documents —
 * so the only thing still needed from a patch is what the two sides were.
 *
 * That matters in one place: a chat tool card has a PATCH and no documents, and
 * the card draws the same merge surface the diff panel does. Reconstructing the
 * sides here keeps one renderer for both, instead of the card growing a second
 * diff implementation that drifts.
 *
 * **The gap between hunks is restored as blank lines, and that is what keeps the
 * gutter honest.** A hunk header names the line it starts on (`@@ -43,7 +43,8`),
 * and a document rebuilt by concatenating hunks would number the change from 1.
 * Padding each side up to the header's own counters puts the change back on the
 * line the file has it on — and because the padding is unchanged content, the
 * merge view collapses it into one marker (`contentMode: 'diff'`).
 *
 * The counters are the patch's own (`+`/`-` rows, hunk headers excluded), which
 * is what the card's header prints. The diff panel deliberately does NOT use
 * them: it has the real documents, and its counts must describe the rows the
 * merge view actually draws (a collapsed or whitespace-folded change is not a
 * changed row on screen).
 */

/** One side's text, and what the patch said about it. */
export interface PatchSides {
  /** The document before the change, with the hunk gaps as blank lines. */
  original: string;
  /** The document after it, the same way. */
  next: string;
  additions: number;
  deletions: number;
  /** Content rows the patch produced — zero for a header-only or empty patch. */
  rows: number;
  /** The patch named at least one hunk (`@@`), so it is a real diff. */
  hasHunk: boolean;
}

const EMPTY: PatchSides = { original: '', next: '', additions: 0, deletions: 0, rows: 0, hasHunk: false };

/** Header lines that describe the patch rather than its content. */
const HEADER_PREFIXES = [
  'diff --git',
  'index ',
  '---',
  '+++',
  'new file mode',
  'deleted file mode',
  'similarity index',
  'dissimilarity index',
  'rename from',
  'rename to',
  'copy from',
  'copy to',
  'old mode',
  'new mode',
  '\\ No newline',
];

/** `@@ -43,7 +43,8 @@` → the two starting lines; anything else → null. */
function hunkStarts(line: string): { old: number; next: number } | null {
  const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (!match) return null;
  return { old: Number(match[1]), next: Number(match[2]) };
}

/** Pad `lines` with blanks until it holds `count` lines. */
function padTo(lines: string[], count: number): void {
  while (lines.length < count) lines.push('');
}

export function patchSides(patch: string): PatchSides {
  if (!patch.trim()) return EMPTY;

  const before: string[] = [];
  const after: string[] = [];
  let additions = 0;
  let deletions = 0;
  let rows = 0;
  let hasHunk = false;

  const lines = patch.split(/\r?\n/);
  // A patch ends with a newline, and `split` turns that into a final empty
  // string. It is the terminator, not a blank row: keeping it put an empty line
  // at the end of BOTH documents, which the merge view drew as a chunk.
  if (lines[lines.length - 1] === '') lines.pop();

  for (const raw of lines) {
    if (HEADER_PREFIXES.some((prefix) => raw.startsWith(prefix))) continue;

    if (raw.startsWith('@@')) {
      hasHunk = true;
      const starts = hunkStarts(raw);
      // `-0,0` (a new file) has no original line to reach, and `padTo` is a
      // no-op for it because the count is below what is already there.
      if (starts) {
        padTo(before, starts.old - 1);
        padTo(after, starts.next - 1);
      }
      continue;
    }

    if (raw.startsWith('+')) {
      additions++;
      rows++;
      after.push(raw.slice(1));
      continue;
    }
    if (raw.startsWith('-')) {
      deletions++;
      rows++;
      before.push(raw.slice(1));
      continue;
    }
    // A context row (` ` prefix) is on BOTH sides; a bare line is what a
    // header-less patch carries, and it is context too.
    const text = raw.startsWith(' ') ? raw.slice(1) : raw;
    rows++;
    before.push(text);
    after.push(text);
  }

  return {
    original: before.join('\n'),
    next: after.join('\n'),
    additions,
    deletions,
    rows,
    hasHunk,
  };
}
