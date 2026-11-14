/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A unified diff from two texts, for the journal diff tab's Copy action.
 *
 * The diff panel renders the two sides itself (`@codemirror/merge`), so this
 * patch is not what the reader sees — it is what "Copy diff text" puts on the
 * clipboard, and what a plugin's diff renderer receives. Keeping it here (not
 * in the server module) means the same function can be tested without a
 * session, and a future client-side caller gets the same answer.
 *
 * Line-based LCS, capped: a pair whose product exceeds {@link MAX_LCS_CELLS}
 * falls back to "every old line removed, every new line added". That is still a
 * valid patch, and it keeps a 20 000-line file from allocating a 400M-cell
 * table on a request thread.
 */

/** Context lines around each change, as `git diff` emits by default. */
const CONTEXT = 3;
/** Above this many DP cells, fall back to a whole-file replacement. */
const MAX_LCS_CELLS = 4_000_000;

type Op = { kind: ' ' | '-' | '+'; text: string };

/** Split into lines, dropping the empty tail a trailing newline produces. */
function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Line-level LCS edit script from `a` to `b`. */
function editScript(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_LCS_CELLS) {
    return [
      ...a.map((text): Op => ({ kind: '-', text })),
      ...b.map((text): Op => ({ kind: '+', text })),
    ];
  }
  // `dp[i][j]` = LCS length of a[i..] and b[j..].
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: ' ', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: '-', text: a[i] });
      i++;
    } else {
      ops.push({ kind: '+', text: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ kind: '-', text: a[i++] });
  while (j < m) ops.push({ kind: '+', text: b[j++] });
  return ops;
}

/** `start,count` of a unified hunk range; a zero-length range names the line before it. */
function hunkRange(start: number, count: number): string {
  return `${count === 0 ? start : start + 1},${count}`;
}

/**
 * Unified diff turning `before` into `after` at `path`; `''` when they are
 * equal. `path` is the display path (repo- or cwd-relative).
 */
export function unifiedDiff(path: string, before: string, after: string): string {
  if (before === after) return '';
  const ops = editScript(splitLines(before), splitLines(after));
  const changed: number[] = [];
  for (let index = 0; index < ops.length; index++) {
    if (ops[index].kind !== ' ') changed.push(index);
  }
  if (changed.length === 0) return '';

  // Group changed indices into hunks, merging when the gap is within twice the
  // context (the same rule `git diff` uses).
  const ranges: Array<[number, number]> = [];
  let start = Math.max(0, changed[0] - CONTEXT);
  let end = Math.min(ops.length - 1, changed[0] + CONTEXT);
  for (let k = 1; k < changed.length; k++) {
    const index = changed[k];
    if (index - end <= 2 * CONTEXT) {
      end = Math.min(ops.length - 1, index + CONTEXT);
    } else {
      ranges.push([start, end]);
      start = Math.max(0, index - CONTEXT);
      end = Math.min(ops.length - 1, index + CONTEXT);
    }
  }
  ranges.push([start, end]);

  let out = `--- a/${path}\n+++ b/${path}\n`;
  for (const [from, to] of ranges) {
    let oldLine = 1;
    let newLine = 1;
    for (let index = 0; index < from; index++) {
      if (ops[index].kind !== '+') oldLine++;
      if (ops[index].kind !== '-') newLine++;
    }
    let oldCount = 0;
    let newCount = 0;
    for (let index = from; index <= to; index++) {
      if (ops[index].kind !== '+') oldCount++;
      if (ops[index].kind !== '-') newCount++;
    }
    out += `@@ -${hunkRange(oldLine - 1, oldCount)} +${hunkRange(newLine - 1, newCount)} @@\n`;
    for (let index = from; index <= to; index++) out += `${ops[index].kind}${ops[index].text}\n`;
  }
  return out;
}
