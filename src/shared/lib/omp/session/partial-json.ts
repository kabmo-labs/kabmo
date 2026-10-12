/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Read a tool call's arguments WHILE they are still arriving.
 *
 * omp streams a tool call's arguments as JSON text, one fragment per
 * `toolcall_delta`. In the accumulated shape (a build that ignores
 * `set_event_filter`) omp parses that buffer itself on the way through
 * (`parseStreamingJsonThrottled`) and hands the result over as
 * `block.arguments`, so the card's subtitle, its subject chip and the
 * generating indicator's verb all have something to read from the first
 * fragment. In DELTA mode that field is absent and only the raw text
 * accumulates, which is what this module exists to repair — see
 * `delta-accumulator.ts`.
 *
 * The rule that matters: a value is used only once it is PROVABLY complete.
 * A truncated `{"timeout": 30` must not report `30`, because the fragment that
 * finishes it may be `0` — a wrong number shown for a moment is worse than no
 * number shown. So a string needs its closing quote, a number needs the
 * delimiter that ends it, and a container needs its closer; anything short of
 * that is dropped and the next fragment tries again. That is also why this is
 * not a "close the brackets and hope" repair: that shape invents values.
 *
 * A drop is not an error. The parser returns what it could prove, which is
 * routinely `{}` for the first fragment of a call and grows from there.
 */

/** Longest input this parser will scan; a tool call's args never legitimately
 *  approach this, and the guard keeps a pathological buffer bounded. */
const MAX_SCAN_LENGTH = 1_000_000;

interface Scanned {
  value: unknown;
  /** Index just past the token. */
  end: number;
  /** True when the token consumed its own closer. */
  closed?: boolean;
  /** True when the scan stopped because a token was still arriving, not
   *  because the buffer held something the grammar does not allow. */
  truncated?: boolean;
}

function skipWhitespace(text: string, index: number): number {
  let i = index;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    // JSON whitespace: space, \t, \n, \r.
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) i += 1;
    else break;
  }
  return i;
}

/** A complete JSON string literal, or undefined while it is still open. */
function scanString(text: string, index: number): Scanned | undefined {
  if (text[index] !== '"') return undefined;
  let i = index + 1;
  let out = '';
  while (i < text.length) {
    const char = text[i];
    if (char === '\\') {
      const escape = text[i + 1];
      if (escape === undefined) return undefined; // truncated mid-escape
      out += char + escape;
      i += 2;
      continue;
    }
    if (char === '"') {
      try {
        return { value: JSON.parse(`"${out}"`), end: i + 1 };
      } catch {
        return undefined;
      }
    }
    out += char;
    i += 1;
  }
  return undefined; // the closing quote has not arrived
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;

/** True when the character at `index` ends a value rather than extending it. */
function isDelimiter(text: string, index: number): boolean {
  if (index >= text.length) return false; // still streamable — not yet a token
  const char = text[index];
  return char === ',' || char === '}' || char === ']' || char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

/** A value that is complete enough to show, or undefined if it is still open.
 *  `closed` is true only for a token that consumed its own closer, which is
 *  what lets a caller tell a finished container from one whose brace is still
 *  streaming — see `scanObject`. */
function scanValue(text: string, index: number): Scanned | undefined {
  const char = text[index];
  if (char === undefined) return undefined;
  if (char === '"') return scanString(text, index);
  if (char === '{') return scanObject(text, index);
  if (char === '[') return scanArray(text, index);
  for (const literal of ['true', 'false', 'null'] as const) {
    if (text.startsWith(literal, index)) {
      if (!isDelimiter(text, index + literal.length)) return undefined;
      const value = literal === 'true' ? true : literal === 'false' ? false : null;
      return { value, end: index + literal.length, closed: true };
    }
  }
  const match = NUMBER.exec(text.slice(index));
  // A number at the very end of the buffer may still be growing (`30` → `300`),
  // so it counts only once something delimits it.
  if (match && isDelimiter(text, index + match[0].length)) {
    return { value: Number(match[0]), end: index + match[0].length, closed: true };
  }
  return undefined;
}

/** A complete array of complete values, or undefined while it is still open. */
function scanArray(text: string, index: number): Scanned | undefined {
  let i = skipWhitespace(text, index + 1);
  const out: unknown[] = [];
  for (;;) {
    if (i >= text.length) return { value: out, end: i, truncated: true }; // no closer yet
    if (text[i] === ']') return { value: out, end: i + 1, closed: true };
    const element = scanValue(text, i);
    if (!element) return { value: out, end: i, truncated: true }; // element still arriving
    out.push(element.value);
    i = skipWhitespace(text, element.end);
    if (text[i] === ',') {
      i = skipWhitespace(text, i + 1);
      continue;
    }
    if (text[i] === ']') return { value: out, end: i + 1, closed: true };
    if (text[i] === undefined) return { value: out, end: i, truncated: true };
    return undefined; // a real grammar violation
  }
}

/** Complete `"key": value` pairs, dropping a pair whose value is still arriving. */
function scanObject(text: string, index: number): Scanned | undefined {
  if (text[index] !== '{') return undefined;
  let i = skipWhitespace(text, index + 1);
  const out: Record<string, unknown> = {};
  for (;;) {
    if (i >= text.length) return { value: out, end: i, truncated: true };
    if (text[i] === '}') return { value: out, end: i + 1, closed: true };
    const key = scanString(text, i);
    if (!key) return { value: out, end: i, truncated: true }; // key still arriving
    i = skipWhitespace(text, key.end);
    if (text[i] !== ':') {
      return text[i] === undefined ? { value: out, end: i, truncated: true } : undefined;
    }
    i = skipWhitespace(text, i + 1);
    const value = scanValue(text, i);
    // The trailing pair is routinely the one still streaming; keeping the pairs
    // before it is the whole point, and committing a half-parsed value is not.
    // An OPEN container is dropped for the same reason a partial string is: its
    // `{}` is not the object the stream will end up with.
    if (!value || (typeof value.value === 'object' && value.value !== null && !value.closed)) {
      return { value: out, end: i, truncated: true };
    }
    out[String(key.value)] = value.value;
    i = skipWhitespace(text, value.end);
    if (text[i] === ',') {
      i = skipWhitespace(text, i + 1);
      continue;
    }
    if (text[i] === '}') return { value: out, end: i + 1, closed: true };
    if (text[i] === undefined) return { value: out, end: i, truncated: true };
    return undefined; // a real grammar violation
  }
}

/**
 * Parse a possibly-truncated JSON object, returning the complete pairs it
 * holds. `undefined` for anything that is not (yet) an object — including the
 * empty buffer before the first fragment.
 */
export function parsePartialJsonObject(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_SCAN_LENGTH) return undefined;
  if (trimmed[0] !== '{') return undefined;
  // The common case is a buffer that already closed; one strict parse settles it.
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    // Truncated mid-value: fall through to the tolerant scan.
  }
  const scanned = scanObject(trimmed, 0);
  if (!scanned || typeof scanned.value !== 'object' || scanned.value === null) return undefined;
  // Trailing characters that no pair accounted for mean this was not a plain
  // object buffer — refuse rather than report a prefix of something else. A
  // buffer that simply ended mid-token is the normal streaming case.
  if (!scanned.truncated && skipWhitespace(trimmed, scanned.end) !== trimmed.length) return undefined;
  return scanned.value as Record<string, unknown>;
}
