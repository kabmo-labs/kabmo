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
 * `0` as success is worse, because the client keeps xterm attached to a stream
 * with a hole in it — exactly the mid-sequence corruption the drop rule exists
 * to prevent. Measured against Bun 1.4.4, 20,000 frames of 4 KiB: the old
 * `!== -1` rule stopped at frame 160 (655 KiB, 0.8 %) while the socket was
 * still accepting, and a 40,000 × 1 KiB burst returned `-1` 17,870 times and
 * `0` 20,851 times.
 *
 * Never call this with an empty frame: `send('')` succeeds but reports `0`.
 */
export function frameAccepted(result: number): boolean {
  return result !== 0;
}
