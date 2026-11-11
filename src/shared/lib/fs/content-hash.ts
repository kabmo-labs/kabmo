/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The content fingerprint the editor uses to decide whether the file on disk is
 * still the one its buffer holds.
 *
 * An mtime is the wrong question. `git checkout`, a formatter, a `touch` and a
 * save that writes identical bytes all move it without changing a byte, so an
 * mtime-only watcher reloads a tab (and loses the caret) over a file that is
 * exactly what the reader already has. The inverse also happens: one
 * millisecond of filesystem clock granularity can hide two writes, which the
 * save path's conflict guard documents as its own blind spot.
 *
 * SHA-256 rather than MD5 because it comes from WebCrypto, which the page and
 * the server both already have with no import; this is a change DETECTOR, not a
 * security boundary.
 *
 * Every producer hashes the SAME thing — the UTF-8 encoding of the text the
 * read route returned — so the server's digest of a file, the digest of the
 * bytes a client wrote, and the digest of the buffer the client holds are the
 * same string whenever the bytes are.
 */
export async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
