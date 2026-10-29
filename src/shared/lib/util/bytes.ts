/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A byte view the web platform will accept as a body.
 *
 * `BodyInit`, `BlobPart` and `WebSocket.send` take `BufferSource`, which
 * TypeScript types as `ArrayBufferView<ArrayBuffer>` — a view backed by a plain
 * `ArrayBuffer`. A `Uint8Array` is typed `Uint8Array<ArrayBufferLike>`, because
 * its buffer may be a `SharedArrayBuffer`, and the web platform genuinely
 * refuses those: `new Response(sharedView)` throws at runtime.
 *
 * So the type error is not noise, and a bare `as` would be a lie. This function
 * is the one place the rule is stated: a view over a plain `ArrayBuffer` is
 * returned as-is (no copy — this is the hot path for every served asset), and a
 * shared-backed view is COPIED, which is both the fix and what makes it work.
 *
 * Bun's own byte producers (`Bun.file().arrayBuffer()`, `Buffer` from a pipe,
 * `Bun.gzipSync`) are never shared-backed, so the copy branch is unreachable
 * from them; it exists for a caller that hands over a view from `Atomics`.
 */

/** The same bytes, guaranteed to be backed by a plain `ArrayBuffer`. */
export function bodyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) return bytes as Uint8Array<ArrayBuffer>;
  // Shared-backed: the platform rejects it, so the copy is not an optimization
  // but the only way these bytes can be sent at all.
  return new Uint8Array(bytes);
}
