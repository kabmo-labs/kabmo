/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Split one ghostty-web `onData` payload into the channel the PTY needs.
 *
 * ghostty-web has no `onBinary` (xterm's separate channel for non-UTF-8
 * payloads). Its legacy X10 mouse report is built with `String.fromCharCode`
 * from values up to 255, so `TextEncoder` would turn a 6-byte report into 7+
 * bytes and the shell would receive the wrong sequence. SGR mouse reports are
 * printable ASCII and stay on the text path.
 *
 * X10 is exactly `ESC [ M` followed by three bytes; a payload with that prefix
 * is forwarded through the byte channel unchanged otherwise.
 */

const X10_MOUSE_PREFIX = '\x1b[M';
const X10_MOUSE_LENGTH = X10_MOUSE_PREFIX.length + 3;

export type TerminalInputFrame = { text: string; bytes?: undefined } | { text?: undefined; bytes: Uint8Array };

export function terminalInputFrame(data: string): TerminalInputFrame {
  if (!data.startsWith(X10_MOUSE_PREFIX) || data.length < X10_MOUSE_LENGTH) {
    return { text: data };
  }
  const bytes = new Uint8Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    bytes[index] = data.charCodeAt(index) & 0xff;
  }
  return { bytes };
}
