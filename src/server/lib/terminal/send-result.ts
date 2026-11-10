/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What `Bun.ServerWebSocket.send`'s return value means — the one fact the
 * terminal's drop rule rests on, kept here because both readings of it are
 * silent failures.
 *
 * Bun 1.4.4 (`bun.com/docs/runtime/websockets`, Backpressure):
 *
 * - **`> 0`** — that many bytes were queued. Sent.
 * - **`-1`** — queued *with backpressure*: the socket is over its high-water
 *   mark, and Bun calls `drain` once the buffered data has been written. **The
 *   frame is delivered.** This is the normal state of a terminal under a burst.
 * - **`0`** — **dropped**: the connection is closed, or it already buffered
 *   more than `backpressureLimit` (16 MiB by default). The bytes are gone.
 *
 * Reading `-1` as failure closes a healthy viewer at the first burst; reading
 * `0` as success is worse, because the client keeps the terminal attached to a
 * stream with a hole in it — exactly the mid-sequence corruption the drop rule exists
 * to prevent. Measured against Bun 1.4.4, 20,000 frames of 4 KiB: the old
 * `!== -1` rule stopped at frame 160 (655 KiB, 0.8 %) while the socket was
 * still accepting, and a 40,000 × 1 KiB burst returned `-1` 17,870 times and
 * `0` 20,851 times.
 *
 * Never call this with an empty frame: `send('')` succeeds but reports `0`.
 *
 * The module also owns `asBinaryFrame`, the other half of handing a frame to
 * Bun's socket: Elysia only keeps bytes binary when they arrive as a Buffer.
 */
export function frameAccepted(result: number): boolean {
  return result !== 0;
}

/**
 * Hand raw terminal bytes to Elysia as a Buffer.
 *
 * Elysia's `ws.send` JSON-stringifies every object that is not a Buffer
 * (`node_modules/elysia/dist/ws/index.js`: `Buffer.isBuffer(data) ? raw.send(data)
 * : … typeof data == "object" && (data = JSON.stringify(data))`). A
 * `Uint8Array` therefore reaches the browser as TEXT — measured: the shell's
 * `echo` arrived as `{"0":101,"1":99,…}` and the client dropped it as an
 * unknown control frame. That is a correctness bug first, and a throughput bug
 * second: every output byte expands to ~4 JSON bytes and the client must parse
 * them back.
 *
 * `Buffer.from(arrayBuffer, offset, length)` is a VIEW over the same memory, so
 * this does not copy a PTY frame. No cast is needed: Buffer is a Uint8Array,
 * and `Buffer.isBuffer` is what selects Elysia's binary branch.
 */
export function asBinaryFrame(frame: string | Uint8Array): string | Buffer {
  if (typeof frame === 'string') return frame;
  return Buffer.isBuffer(frame) ? frame : Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
}
