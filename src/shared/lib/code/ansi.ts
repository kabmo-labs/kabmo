/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * ANSI escape stripper for chat timeline tool output.
 *
 * Timeline cards render with Shiki (`Bash`, `FallbackOutput`), which treats
 * raw `\x1b[…m` sequences as literal text — so escapes are dropped here
 * first and the clean text goes to the highlighter. True terminal colors
 * stay available in the realtime xterm panel, which parses ANSI natively.
 */

/** Any ANSI escape: OSC hyperlink, charset select, or CSI sequence. */
const ANSI_ESCAPE_RE =
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b\[[0-9;?]*[A-Za-z]/g;

/** Drop every ANSI escape and normalize carriage returns to newlines. */
export function stripAnsiCodes(text: string): string {
  if (!text) return '';
  if (!text.includes('\x1b')) return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return text.replace(ANSI_ESCAPE_RE, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
