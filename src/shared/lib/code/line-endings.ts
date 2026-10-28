/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Line-ending preservation for the file-editing surfaces.
 *
 * Two independent transports destroy the distinction, so the file's own ending
 * has to be carried out of band rather than inferred from the buffer:
 *
 * - A `<textarea>` cannot hold a CRLF. The HTML spec defines its *API value* as
 *   the raw value with every carriage return removed, so the instant a CRLF file
 *   is placed in the editing surface the buffer is LF-only — verified in
 *   Chromium: `textarea.value = 'a\r\nb'` reads back `'a\nb'`.
 * - `multipart/form-data` normalizes the other way: every bare LF in a field
 *   value becomes CRLF in transit (the HTML serializer on the way out, Bun's
 *   parser agreeing on the way in). A save payload therefore cannot say "LF" no
 *   matter what the buffer held.
 *
 * Saving the buffer as-is rewrote the whole file's line endings on a
 * one-character edit — every line showed as changed in `git diff`. The ending is
 * detected at read and travels as its own field; the server builds the bytes.
 * An unedited save is then byte-identical and an edited save a one-line diff.
 *
 * Detection is by the FIRST terminator rather than a vote over all of them: a
 * file is overwhelmingly uniform, and the first ending is the one the author's
 * editor writes. A file with no terminator, or one using lone CR (classic Mac
 * OS), reads as `lf`.
 */

export type LineEnding = 'lf' | 'crlf';

/** The ending the file uses, judged by its first terminator. */
export function detectLineEnding(text: string): LineEnding {
  const index = text.indexOf('\n');
  return index > 0 && text[index - 1] === '\r' ? 'crlf' : 'lf';
}

/**
 * The buffer form: CRLF and lone CR collapsed to LF, matching what a textarea
 * can actually hold. A string already free of CR is returned unchanged.
 */
export function toLf(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

/**
 * The disk form: `text` normalized — whatever mix of endings it carries, and
 * whether or not it came back through a transport that rewrote them — and then
 * written with `ending`.
 */
export function toDiskText(text: string, ending: LineEnding): string {
  const lf = toLf(text);
  return ending === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf;
}
