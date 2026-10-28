/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The hand-rolled XML scanner behind `xml-envelope.ts`.
 *
 * It is separate because it is the part that must never throw and never guess:
 * it parses arbitrary tool output — a log, an HTML dump, a rule's own TypeScript
 * sample — with no `DOMParser` available (this module is shared with the
 * server). Every entry point returns `undefined` for malformed markup instead of
 * inventing a tag, which is what lets the envelope scan treat "not a tag" and
 * "not balanced" as the same answer.
 */

export interface Tag {
  kind: 'start' | 'end' | 'self' | 'other';
  name: string;
  /** Raw text between the name and the closing `>`. */
  attrs: string;
  /** Index just past the tag's `>`. */
  end: number;
}

/** One scanned element: its identity plus the index just past its closing tag. */
export interface ScannedElement {
  tag: string;
  attributes: Record<string, string>;
  inner: string;
  end: number;
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
const ATTR_RE = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** Attributes of a start tag: `reason="rule_violation" flag`. */
export function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of raw.matchAll(ATTR_RE)) {
    attributes[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}

/** Index of the tag's closing `>` — an attribute value may contain `>`. */
export function tagEnd(text: string, from: number): number {
  let quote = '';
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

/** Read the markup starting at `<`. Comments, CDATA and processing
 *  instructions come back as `other` so their contents can never be read as
 *  tags. Returns undefined for anything malformed. */
export function readTag(text: string, at: number): Tag | undefined {
  const head = text.slice(at, at + 9);
  if (head.startsWith('<!--')) {
    const close = text.indexOf('-->', at + 4);
    return close === -1 ? undefined : { kind: 'other', name: '', attrs: '', end: close + 3 };
  }
  if (head === '<![CDATA[') {
    const close = text.indexOf(']]>', at + 9);
    return close === -1 ? undefined : { kind: 'other', name: '', attrs: '', end: close + 3 };
  }
  if (text[at + 1] === '!' || text[at + 1] === '?') {
    const close = tagEnd(text, at + 2);
    return close === -1 ? undefined : { kind: 'other', name: '', attrs: '', end: close + 1 };
  }

  const closing = text[at + 1] === '/';
  const nameAt = at + (closing ? 2 : 1);
  const name = NAME_RE.exec(text.slice(nameAt, nameAt + 64))?.[0];
  if (!name) return undefined;
  const close = tagEnd(text, nameAt + name.length);
  if (close === -1) return undefined;
  const attrs = text.slice(nameAt + name.length, close);
  if (closing) return { kind: 'end', name, attrs, end: close + 1 };
  return { kind: text[close - 1] === '/' ? 'self' : 'start', name, attrs, end: close + 1 };
}

/** Drop the indentation every line shares — XML pretty-printing padding that
 *  markdown would otherwise read as an indented code block. */
export function stripCommonIndent(text: string): string {
  const lines = text.split('\n');
  // The line breaks hugging the wrapper tags are padding, not content.
  if (lines.length > 1 && !lines[0].trim()) lines.shift();
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();

  let indent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim()) indent = Math.min(indent, line.length - line.trimStart().length);
  }
  if (!Number.isFinite(indent)) return '';
  if (indent === 0) return lines.join('\n');
  return lines.map((line) => line.slice(Math.min(indent, line.length - line.trimStart().length))).join('\n');
}

/** Length of the run of `ch` starting at `from` (0 when it is a different char). */
function runLength(text: string, from: number, ch: string): number {
  let i = from;
  while (i < text.length && text[i] === ch) i += 1;
  return i - from;
}

/** Scan one element opening at `from`. Returns undefined when the markup there
 *  is not a balanced, whole element.
 *
 *  The scan is markdown-aware: a ``` fence and an inline `` ` `` span are code,
 *  not markup, so the `<` inside a rule's TypeScript sample is skipped. */
export function scanElement(text: string, from: number): ScannedElement | undefined {
  const root = readTag(text, from);
  if (!root || root.kind !== 'start') return undefined;

  const stack = [root.name];
  // Fence state: an open fence swallows everything up to its closing run.
  let fenceChar = '';
  let fenceLen = 0;
  // An inline span opens at a run of backticks that is not a fence and closes
  // at the next run of the SAME length — `a ` b` is one span, not two.
  let spanLen = 0;
  let atLineStart = false;

  for (let i = root.end; i < text.length; ) {
    const ch = text[i];
    if (ch === '\n') {
      atLineStart = true;
      i += 1;
      continue;
    }
    if (fenceLen === 0 && spanLen === 0 && (ch === ' ' || ch === '\t')) {
      i += 1;
      continue;
    }
    const lineStart = atLineStart;
    atLineStart = false;

    if (fenceLen > 0) {
      // Only a line-initial run of the same char and length closes the fence.
      if (lineStart && ch === fenceChar && runLength(text, i, fenceChar) >= fenceLen) {
        const newline = text.indexOf('\n', i);
        i = newline === -1 ? text.length : newline + 1;
        fenceChar = '';
        fenceLen = 0;
        atLineStart = true;
        continue;
      }
      i += 1;
      continue;
    }

    if (ch === '`' || ch === '~') {
      const run = runLength(text, i, ch);
      if (spanLen > 0) {
        // Inside an inline span: only the same-length run closes it.
        if (ch === '`' && run === spanLen) spanLen = 0;
        i += run;
        continue;
      }
      if (lineStart && ch === '`' && run >= 3) {
        fenceChar = ch;
        fenceLen = run;
        const newline = text.indexOf('\n', i);
        i = newline === -1 ? text.length : newline + 1;
        atLineStart = true;
        continue;
      }
      if (ch === '`') {
        // A span only exists when a matching run closes it; otherwise the
        // backtick is a lone one (omp writes `` for an empty argument) and
        // treating it as an opener would swallow the element's end tag.
        if (text.indexOf('`'.repeat(run), i + run) !== -1) {
          spanLen = run;
          i += run;
          continue;
        }
        i += run;
        continue;
      }
      i += run;
      continue;
    }

    // A span's body is code, not markup: `<typeof fn>` inside `` ` `` is text.
    if (spanLen > 0) {
      i += 1;
      continue;
    }

    if (ch !== '<') {
      i += 1;
      continue;
    }
    const tag = readTag(text, i);
    if (!tag) return undefined;
    if (tag.kind === 'start') {
      stack.push(tag.name);
    } else if (tag.kind === 'end') {
      if (stack.pop() !== tag.name) return undefined;
      if (stack.length === 0) {
        return {
          tag: root.name,
          attributes: parseAttributes(root.attrs),
          inner: stripCommonIndent(text.slice(root.end, i)),
          end: tag.end,
        };
      }
    }
    i = tag.end;
  }
  return undefined;
}
