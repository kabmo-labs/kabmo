/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * JSON with comments, for `deno.jsonc`.
 *
 * Deno's config allows `//` and `/* *​/` comments and trailing commas, so
 * `JSON.parse` rejects a perfectly valid file — and the failure would surface as
 * "Could not read deno.jsonc", which reads like a broken file rather than a
 * format this does not handle.
 *
 * The stripper is STRING-AWARE, and that is the whole difficulty: a naive
 * `/\/\/.*$/gm` cuts a URL in half. `"https://deno.land/x"` would become
 * `"https:` — measured against a real import map, where the comment regex ate
 * the scheme. So the scan tracks whether it is inside a string, and honours
 * backslash escapes, before it ever looks for a comment.
 *
 * A trailing comma is left to the caller: `JSON.parse` rejects it, and removing
 * commas correctly means knowing they are not inside a string either — which this
 * already tracks, so it is done here for the same reason.
 */

/** Strip `//` and comment markers outside strings, plus trailing commas. */
export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    // A line comment runs to the end of the line, keeping the newline so the
    // offsets a parse error reports still point at the right line.
    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }

    if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1; // land on the closing `/`
      continue;
    }

    out += char;
  }

  // A trailing comma is valid JSONC and invalid JSON: drop a comma whose next
  // non-space character closes an object or array.
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Parse JSON that may carry comments, falling back to plain JSON first. */
export function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(stripJsonComments(text));
  }
}
