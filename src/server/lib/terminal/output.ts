/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Coalesces PTY reads into one frame per flush.
 *
 * `Bun.Terminal` hands its `data` callback whatever one read returned, which for
 * a line-oriented producer is tiny: `seq 1 300000` arrived as 182,259 reads,
 * p50 = 12 bytes, 419 reads/ms. Forwarding each read as its own WebSocket frame
 * (what the session used to do) spends the socket on framing instead of bytes:
 * 249,349 frames carried 33.7 MB at 2.12 MB/s, and the same output coalesced
 * into ~1,300 frames reached 6.9–7.3 MB/s — 3.3× on the same xterm, and the
 * ceiling was then the PTY producer itself, not the client.
 *
 * Three things this deliberately does not do:
 *
 * - **Copy on push.** Bun does not reuse the buffer it hands `data` (verified
 *   against 1.4.4: 2,000 `seq` lines collected across 1,104 reads and
 *   concatenated after exit are byte-identical), and `history.append` already
 *   retains those views for its 512 KiB scrollback, so a defensive copy per
 *   read would cost exactly what the coalescing is there to save.
 * - **Split sequences.** the parser reads a byte stream across `write` calls, so a
 *   frame boundary mid-escape is harmless — dropping bytes is not, which is why
 *   a flush never discards anything it accepted.
 * - **Buffer without a bound.** The flush is size- or time-triggered, so a
 *   flood becomes 8 KiB frames instead of growing a queue.
 */

/** Quiet period before a partial frame is flushed: two 60 Hz frames' worth. */
export const OUTPUT_FLUSH_MS = 4;

/** Pending bytes that force a flush without waiting for the timer. */
export const OUTPUT_FLUSH_BYTES = 8 * 1024;

export interface TerminalOutputQueue {
  /** Accept one PTY read. Delivered now if the frame is already full. */
  push: (bytes: Uint8Array) => void;
  /** Deliver everything pending — used before a replay and before control frames. */
  flush: () => void;
  /** Drop pending bytes and the timer; the session record is going away. */
  dispose: () => void;
}

/**
 * One queue per PTY session. `sink` receives the concatenated frame and is the
 * session's own fan-out, so a queue never has to know about viewers.
 */
export function createTerminalOutputQueue(sink: (frame: Uint8Array) => void): TerminalOutputQueue {
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pendingBytes === 0) return;
    // A single read is passed through: on `cat` of a large file most flushes
    // are one 1 KiB read, and a copy there would buy nothing.
    const frame = pending.length === 1 ? pending[0] : join(pending, pendingBytes);
    pending = [];
    pendingBytes = 0;
    sink(frame);
  };

  return {
    push(bytes) {
      if (bytes.length === 0) return;
      pending.push(bytes);
      pendingBytes += bytes.length;
      if (pendingBytes >= OUTPUT_FLUSH_BYTES) {
        flush();
        return;
      }
      if (timer === null) {
        timer = setTimeout(flush, OUTPUT_FLUSH_MS);
        // A pending flush must never hold the server open at shutdown.
        timer.unref?.();
      }
    },
    flush,
    dispose() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = [];
      pendingBytes = 0;
    },
  };
}

function join(parts: Uint8Array[], total: number): Uint8Array {
  const frame = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    frame.set(part, offset);
    offset += part.length;
  }
  return frame;
}
