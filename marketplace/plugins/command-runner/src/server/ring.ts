/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The run record's output buffer: a bounded ring, and the text a reader gets.
 *
 * Split from the registry because it is PURE — a ring of chunks and two
 * functions over it — and because the two numbers it distinguishes are the whole
 * reason the log view can be honest:
 *
 * - **`bytes` is everything the process produced.** It only ever grows.
 * - **`ringBytes` is what is still held.** It is capped at `RUN_BUFFER_BYTES`.
 *
 * A reader that saw only one of them would either present a window as the whole
 * log or claim output it no longer has. `truncated` is the comparison.
 */

/** The last bytes kept per run. The panel reads a tail of this. */
export const RUN_BUFFER_BYTES = 256 * 1024;

/** The ring as the registry holds it: chunks plus the running total. */
export interface ByteRing {
  chunks: Uint8Array[];
  /** Bytes the ring currently holds (never more than `RUN_BUFFER_BYTES`). */
  held: number;
}

/** An empty ring. */
export function emptyRing(): ByteRing {
  return { chunks: [], held: 0 };
}

/** Append a chunk, dropping the oldest bytes to stay under the cap. */
export function appendToRing(ring: ByteRing, chunk: Uint8Array): void {
  ring.chunks.push(chunk);
  ring.held += chunk.length;
  while (ring.held > RUN_BUFFER_BYTES && ring.chunks.length > 1) {
    const dropped = ring.chunks.shift()!;
    ring.held -= dropped.length;
  }
}

/**
 * A ring's contents as text, ANSI-stripped and cut to `tail` bytes.
 *
 * The cut is from the END, because the last output is what a reader wants: a
 * build that failed says so at the bottom.
 */
export function ringText(ring: ByteRing, tail: number): string {
  const joined = Buffer.concat(ring.chunks);
  const slice = joined.length > tail ? joined.subarray(joined.length - tail) : joined;
  return stripAnsi(slice.toString('utf8'));
}

/**
 * Remove ANSI escape sequences from a log tail.
 *
 * A `<pre>` cannot render them, and Kabmo's own proc panel strips them for
 * the same reason. Deliberately a small local copy rather than an import: the
 * plugin's server bundle cannot reach Kabmo's source (`@/…` does not
 * resolve in it), and the alternative — no stripping — renders `\u001b[0m` as
 * literal text between every word of a coloured build.
 */
export function stripAnsi(text: string): string {
  // CSI sequences, OSC sequences terminated by BEL or ST, and the two-character
  // escapes. Ordered so a string sequence is consumed whole before its bytes can
  // be read as separate escapes.
  return text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}
