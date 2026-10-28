/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Minimal client-side SSE frame reader for `fetch` responses. Both the chat
 * mock stream and the filesystem search stream hand-rolled
 * `response.body.getReader()` + `split('\n\n')` + `event:`/`data:` parsing;
 * this is the one implementation they share.
 *
 * Frame rules follow the SSE spec where the two consumers agreed and take the
 * more complete behavior where they diverged:
 * - `event:` defaults to `"message"` when absent.
 * - Multiple `data:` lines in one frame join with `\n` (neither endpoint emits
 *   them today, so single-line frames are byte-identical to before).
 * - Comment lines (`:` prefix) are ignored.
 * - A trailing frame without a terminating blank line is still delivered.
 *
 * Abort is cooperative: a fired `signal` cancels the reader and resolves
 * normally — callers inspect `signal.aborted` themselves.
 */

/** Return `true` from a frame handler to stop reading (e.g. a terminal frame). */
export type SseFrameHandler = (event: string, data: string) => void | boolean;

/** Parse one raw frame block into `{ event, data }`; null for comment/blank frames. */
function parseFrame(frame: string): { event: string; data: string } | null {
  const trimmed = frame.trim();
  if (!trimmed) return null;

  let event = 'message';
  const dataLines: string[] = [];
  for (const line of trimmed.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.replace(/^event:\s*/, '').trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.replace(/^data:\s*/, ''));
    }
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

/** Deliver one frame to the handler; true when the handler asked to stop. */
function consumeFrame(frame: string, onFrame: SseFrameHandler): boolean {
  const parsed = parseFrame(frame);
  if (!parsed) return false;
  return onFrame(parsed.event, parsed.data) === true;
}

/**
 * Read `response.body` as SSE frames, invoking `onFrame(event, data)` for each.
 * Resolves when the stream ends, the handler stops it, or `signal` aborts.
 */
export async function readSseStream(
  response: Response,
  onFrame: SseFrameHandler,
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    for (;;) {
      if (signal?.aborted) {
        try {
          await reader.cancel();
        } catch {
          // Reader already released.
        }
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        if (consumeFrame(frame, onFrame)) return;
      }
    }

    if (buffer) consumeFrame(buffer, onFrame);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released or cancelled.
    }
  }
}
