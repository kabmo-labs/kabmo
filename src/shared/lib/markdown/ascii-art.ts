/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Straighten the right edge of a hand-drawn box.
 *
 * An agent asked to "render ASCII" of a panel draws a frame and then pads the
 * rows by eye. The frame's own width is the one reliable fact in the output:
 * the horizontal rules (`+---+`, `┌───┐`) are written by the same generator
 * that writes the corners, and every row that starts with a border is meant to
 * close at that same column. Measured on a real answer: the top rule was 101
 * columns, the two description rows closed at 100 and 102, and the boxed rows
 * stopped at 99 — the frame looked broken while the text inside it was fine.
 *
 * The transform is deliberately additive: a misplaced closing border is moved
 * (spaces only, so real content can never be dropped), and a row whose outer
 * border is missing gets one appended. An INNER border is not moved: a row
 * that carries more than its opening and closing verticals is read as nested,
 * and the frame's own border is appended instead of relocating the inner one.
 * Nothing is touched unless the block opens on a CORNERED rule and carries at
 * least two rules, all of the same width — which is what keeps a shell pipe, a
 * tree, a bare `-----` separator, or a bit of prose inside a ```text fence out
 * of it.
 *
 * Display width is assumed to be the string length, which is why a tab or a
 * wide (CJK/emoji) codepoint aborts the pass: padding by index would then
 * overshoot the column it is trying to hold.
 */

/** Vertical border glyphs that may open or close a row. */
const BORDER: Record<string, true> = {
  '|': true, '\u2502': true, '\u2551': true, '\u2503': true,
};
/** A horizontal rule: corners/junctions, dashes, and nothing else. */
const RULE_CHARS: Record<string, true> = { '+': true, '-': true, '\u2500': true, '\u2550': true };
/** Rule glyphs that may sit inside a rule beside its dashes. */
const RULE_JOINTS: Record<string, true> = {
  '\u250c': true, '\u2510': true, '\u2514': true, '\u2518': true, '\u251c': true, '\u2524': true,
  '\u252c': true, '\u2534': true, '\u253c': true, '\u2554': true, '\u2557': true, '\u255a': true,
  '\u255d': true, '\u2560': true, '\u2563': true, '\u2566': true, '\u2569': true, '\u256c': true,
};
/** A line whose laid-out width is not its length: padding by index would lie. */
const WIDE_OR_EMOJI = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{1F000}-\u{1FAFF}]/u;

function isRule(line: string): boolean {
  const body = line.trimEnd();
  if (body.length < 4) return false;
  let dash = false;
  for (const char of body) {
    if (char === '-' || char === '\u2500' || char === '\u2550') dash = true;
    else if (!RULE_CHARS[char] && !RULE_JOINTS[char] && char !== ' ') return false;
  }
  return dash;
}

/** A line that can only be the top of a box: a rule carrying a corner. */
function isFrameRule(line: string): boolean {
  if (!isRule(line)) return false;
  return line.includes('+') || [...line].some((char) => RULE_JOINTS[char] === true);
}

/**
 * The healed text, or the input unchanged when it is not a box drawing.
 * Returns the same string instance when nothing changed, so callers that memo
 * on identity do not pay for a copy.
 */
export function healAsciiBoxes(text: string): string {
  // The cheap gate first: a fence with no vertical border has nothing to close.
  if (!text.includes('|') && !text.includes('\u2502')) return text;
  if (text.includes('\t') || WIDE_OR_EMOJI.test(text)) return text;

  const lines = text.split('\n');
  const carriesCr = new Array<boolean>(lines.length);
  const bodies = lines.map((line, i) => {
    if (!line.endsWith('\r')) return line;
    carriesCr[i] = true;
    return line.slice(0, -1);
  });

  const first = bodies.findIndex((line) => line.trim() !== '');
  if (first < 0 || !isFrameRule(bodies[first])) return text;

  // The top rule is the canvas; a later rule must not widen it. All rules
  // sharing the width is what makes "the frame" a fact rather than a guess.
  let width = bodies[first].trimEnd().length;
  let rules = 0;
  for (const body of bodies) {
    if (!isRule(body)) continue;
    rules += 1;
    if (body.trimEnd().length !== width) return text;
  }
  if (rules < 2) return text;

  const lastNonEmpty = bodies.reduce((last, body, i) => (body.trim() !== '' ? i : last), -1);
  const tail = bodies[lastNonEmpty];
  if (!isRule(tail) && !(tail.length > 0 && BORDER[tail[0]] === true)) return text;

  // Which border the rows use, and that there are rows to fix at all.
  const closers = new Map<string, number>();
  let rows = 0;
  for (let i = first + 1; i < bodies.length; i++) {
    const body = bodies[i];
    if (!body || BORDER[body[0]] !== true) continue;
    rows += 1;
    const trimmed = body.trimEnd();
    const last = trimmed[trimmed.length - 1];
    if (BORDER[last] === true) closers.set(last, (closers.get(last) ?? 0) + 1);
  }
  if (rows < 2 || closers.size === 0) return text;
  let right = '';
  let rightCount = 0;
  for (const [char, count] of closers) {
    if (count > rightCount) {
      right = char;
      rightCount = count;
    }
  }

  let changed = false;
  for (let i = first + 1; i < bodies.length; i++) {
    const body = bodies[i];
    if (!body || BORDER[body[0]] !== true) continue;
    const trimmed = body.trimEnd();
    const last = trimmed[trimmed.length - 1];
    if (BORDER[last] !== true) {
      // The outer border is missing entirely: close the row, keep its content.
      bodies[i] = trimmed.padEnd(width - 1) + right;
      changed = true;
      continue;
    }
    // `trimmed.length` is one past the border's column.
    if (trimmed.length === width) continue;
    let bars = 0;
    for (let j = 0; j < trimmed.length; j++) if (BORDER[trimmed[j]] === true) bars += 1;
    const content = trimmed.slice(0, -1);
    if (trimmed.length > width) {
      // Only whitespace may be removed; a row that overflows real content is
      // left alone rather than truncated.
      if (content.slice(width - 1).trim() !== '') continue;
      bodies[i] = content.slice(0, width - 1) + last;
    } else if (bars > 2) {
      // Left, at least one inner, and a right: the last border is an inner
      // one, so the frame's own closing border is appended instead of moving
      // it and destroying the nesting.
      bodies[i] = trimmed.padEnd(width - 1) + right;
    } else {
      bodies[i] = content.padEnd(width - 1) + last;
    }
    changed = true;
  }

  if (!changed) return text;
  let out = '';
  for (let i = 0; i < bodies.length; i++) out += (i === 0 ? '' : '\n') + bodies[i] + (carriesCr[i] ? '\r' : '');
  return out;
}
