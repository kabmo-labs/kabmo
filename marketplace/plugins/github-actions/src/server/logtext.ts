/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A job log, made readable.
 *
 * The bytes GitHub sends are a runner transcript, not prose: a UTF-8 BOM, one
 * ISO timestamp before every line, ANSI colour (measured: four such lines in a
 * 63 KB log), and workflow commands like `##[group]Run bun test`. Rendering that
 * raw puts escape codes in the panel and 24 characters of timestamp before every
 * word.
 *
 * The folding is deliberately conservative: nothing is dropped except the
 * timestamp and the escapes, group markers become a visible title, and warnings
 * and errors keep GitHub's own words. A log is evidence — a reader scrolling one
 * is looking for the line that failed, so the line must still be there.
 */

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007|\u001b[@-_]/g;
/** `2026-11-20T12:12:32.9658834Z ` — the runner prefixes every line with it. */
const TIMESTAMP = /^\uFEFF?\d{4}-\d{2}-\d{2}T[\d:.]+Z /;

/** One line, without its timestamp, escapes or workflow-command brackets. */
export function cleanLine(raw: string): string {
  const line = raw.replace(ANSI, '').replace(TIMESTAMP, '');
  if (line === '##[endgroup]') return '';
  if (line.startsWith('##[group]')) return `▸ ${line.slice('##[group]'.length).trim()}`;
  if (line.startsWith('##[warning]')) return `⚠ ${line.slice('##[warning]'.length).trim()}`;
  if (line.startsWith('##[error]')) return `✗ ${line.slice('##[error]'.length).trim()}`;
  if (line.startsWith('##[section]')) return `▸ ${line.slice('##[section]'.length).trim()}`;
  return line;
}

/** A whole log, cleaned. Trailing blank lines are trimmed, not interior ones. */
export function cleanLog(raw: string): string {
  const lines = raw.split('\n').map(cleanLine);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/**
 * The last `bytes` of a text, cut on a line boundary.
 *
 * Cutting mid-line leaves a fragment that reads as corruption, so the first
 * partial line is dropped and the answer says it was truncated.
 */
export function tailOf(text: string, bytes: number): { text: string; truncated: boolean } {
  if (bytes <= 0) return { text: '', truncated: text.length > 0 };
  if (text.length <= bytes) return { text, truncated: false };
  const start = text.length - bytes;
  const slice = text.slice(start);
  // A cut that landed exactly on a newline starts a whole line, so nothing is
  // dropped; one that landed mid-line drops the fragment it landed in.
  if (start === 0 || text[start - 1] === '\n') return { text: slice, truncated: true };
  const newline = slice.indexOf('\n');
  return { text: newline >= 0 ? slice.slice(newline + 1) : slice, truncated: true };
}
