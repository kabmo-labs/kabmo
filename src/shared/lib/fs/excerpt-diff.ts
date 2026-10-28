/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * omp's excerpt diff → a unified diff.
 *
 * The diff omp puts on an `edit` result's `details.diff` is NOT unified: every
 * row carries the file's own line number as a gutter, and a change is marked by
 * a sign in front of that number rather than at the start of the line.
 *
 *   ' 41|'                          context
 *   '-43|  return new Promise(…);'  removed
 *   '+43|  const { promise, … };'   added
 *
 * Rendered by a unified-diff parser that gutter is simply code: the row reads
 * `-43|  return …` and the line numbers the reader needs are inside the text
 * they are trying to read (measured in the browser: the `43|` prefix survived
 * into the code cell). This module drops the gutter and emits the standard
 * shape, so ONE parser and ONE renderer serve both omp's excerpt and git's own
 * unified diff.
 *
 * The gutter numbers are also recovered as `oldLine`/`newLine`, which is what
 * lets the renderer draw real line numbers instead of `...`.
 */

export interface ExcerptDiffLine {
  type: 'add' | 'del' | 'context' | 'meta';
  text: string;
  /** Line number in the pre-change file, when the row has one. */
  oldLine?: number;
  /** Line number in the post-change file, when the row has one. */
  newLine?: number;
}

/** `-43|text` / `+43|text` / ` 43|text` — sign, line number, bar, content. */
const ROW_RE = /^([-+ ]?)\s*(\d+)\|(.*)$/;
/** A bare gutter row omp prints for a blank line: `' 44|'`. */
const BARE_ROW_RE = /^([-+ ]?)\s*(\d+)\|$/;

/**
 * True when `text` looks like omp's excerpt diff rather than a unified one.
 *
 * Both shapes contain `+`/`-` rows, so the test has to be positive: a unified
 * diff opens with `---`/`+++`/`@@` headers, and an excerpt carries neither.
 * Getting this wrong in either direction is silent — a misclassified unified
 * diff would have its `-`/`+` signs eaten, and a misclassified excerpt would
 * keep rendering its gutter as code.
 */
export function isExcerptDiff(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return false;
  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@') || line.startsWith('diff --git')) {
      return false;
    }
  }
  // At least one row must carry the gutter, or this is something else entirely.
  return lines.some((line) => ROW_RE.test(line) || BARE_ROW_RE.test(line));
}

/**
 * Parse an omp excerpt diff into typed rows. Every row of the input becomes one
 * row of the output — an unparsable line is kept as context text rather than
 * dropped, because a reader losing a line is worse than a reader seeing one
 * unlabelled.
 */
export function parseExcerptDiff(text: string): ExcerptDiffLine[] {
  const out: ExcerptDiffLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const bare = BARE_ROW_RE.exec(raw);
    if (bare) {
      out.push(rowFor(bare[1], Number(bare[2]), ''));
      continue;
    }
    const match = ROW_RE.exec(raw);
    if (!match) {
      // Not a gutter row: an elision marker (`…`), a note, or a stray blank.
      if (raw.trim() === '') continue;
      out.push({ type: 'meta', text: raw });
      continue;
    }
    out.push(rowFor(match[1], Number(match[2]), match[3]));
  }
  return out;
}

function rowFor(sign: string, lineNumber: number, content: string): ExcerptDiffLine {
  if (sign === '-') return { type: 'del', text: content, oldLine: lineNumber };
  if (sign === '+') return { type: 'add', text: content, newLine: lineNumber };
  return { type: 'context', text: content, oldLine: lineNumber, newLine: lineNumber };
}

/**
 * A standard unified diff for a renderer that only speaks that dialect.
 *
 * The excerpt has no hunk header of its own, so one is synthesized for the
 * whole run: a reader of the unified form needs the `@@` line to know the rows
 * belong together, and the counts must match the rows actually emitted.
 */
export function excerptDiffToUnified(text: string): string {
  const rows = parseExcerptDiff(text);
  if (rows.length === 0) return text;
  const oldLines = rows.filter((row) => row.type !== 'add').length;
  const newLines = rows.filter((row) => row.type !== 'del').length;
  const firstOld = rows.find((row) => row.oldLine !== undefined)?.oldLine ?? 1;
  const firstNew = rows.find((row) => row.newLine !== undefined)?.newLine ?? 1;
  const body = rows.map((row) => {
    if (row.type === 'add') return `+${row.text}`;
    if (row.type === 'del') return `-${row.text}`;
    if (row.type === 'meta') return ` ${row.text}`;
    return ` ${row.text}`;
  });
  return [`@@ -${firstOld},${oldLines} +${firstNew},${newLines} @@`, ...body].join('\n');
}

/** Added/removed row counts, for a card that wants the change size without parsing. */
export function excerptDiffStats(text: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of parseExcerptDiff(text)) {
    if (row.type === 'add') added++;
    else if (row.type === 'del') removed++;
  }
  return { added, removed };
}
