/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * omp's embedded-shell trace is not transcript data, so it never enters one.
 *
 * 18.17.0 attaches `details.trace` — the run's `ShellTrace`, `{units, history}`
 * — to EVERY `bash` progress frame and to the final result, whether or not
 * anyone asked for a visualization: the tool wires `onTrace` whenever it has an
 * `onUpdate` callback, and `display.shellVisualization` only gates omp's own
 * drawing. Its `history` repeats the command's output as `Output` records, so
 * the field is roughly a second copy of the result:
 *
 *   - 40 output lines over 8 s → 192 KB of frames, against 19 KB on 18.16.0;
 *   - 120 lines over 73 s → 242 update frames, 9.2 MB in total;
 *   - a 40 000-line result → 311 KB progress frames, 1.15 MB for the call;
 *   - `seq 1 30000` → a 201 KB trace on the result alone (history 201 KB,
 *     `units` 619 B), carried in the session JSONL as well.
 *
 * Kabmo draws no shell visualization and reads no field of it, while the
 * `session:<id>` topic publishes every frame to each open tab and `details`
 * reaches the client's per-session tool-result map. So the trace is dropped
 * where a child's frames reach subscribers ({@link stripShellTrace}) and again
 * when a transcript is read back from disk ({@link withoutShellTrace}), because
 * omp writes it into the JSONL itself.
 */

import { isRecord } from '@/shared/lib/util/guards';

/**
 * `details` without its shell trace, or the same value when it has none.
 *
 * Returns the SAME reference for a details bag that carries no `trace` — the
 * usual case for every tool but a live `bash` — so callers pay nothing.
 */
export function withoutShellTrace<T>(details: T): T {
  if (!isRecord(details) || !('trace' in details)) return details;
  const { trace: _trace, ...rest } = details;
  return rest as T;
}

/**
 * Drop the trace from a live frame, in place, and hand the frame back.
 *
 * The three carriers, all measured on 18.17.0: `partialResult.details` on
 * `tool_execution_update`, `result.details` on `tool_execution_end`, and
 * `message.details` on a `message_end` toolResult (the same result again, on the
 * message the transcript keeps). In place rather than a copy because the frame
 * is ours — parsed from the child's stdout a moment ago and discarded after the
 * fan-out — and a 300 KB copy per progress frame is the cost this exists to
 * avoid.
 */
export function stripShellTrace<T extends Record<string, unknown>>(frame: T): T {
  for (const holder of [frame.partialResult, frame.result, frame.message]) {
    if (!isRecord(holder)) continue;
    const details = holder.details;
    if (isRecord(details) && 'trace' in details) delete details.trace;
  }
  return frame;
}
