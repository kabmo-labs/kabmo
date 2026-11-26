/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The failure a session's OWN transcript records for its last turn.
 *
 * One harness needs this: `omp-acp`. Its agent answers a provider failure as
 * ordinary assistant text and then ends the turn normally — measured on a real
 * spawn, the ACP envelope said `end_turn` with the body
 * `400 The model agnes-2-5-flash:free is currently unavailable…`, while omp's
 * own JSONL for the same turn carried `stopReason: "error"` and the same
 * message. Reading only the envelope therefore reported a delegated worker as
 * `completed` and handed its coordinator the provider's error as if it were a
 * report.
 *
 * The transcript is authoritative where Kabmo can read it, and `omp-acp` writes
 * omp's JSONL — the one store this module reads. Every other harness reports
 * failure in the envelope itself (`stopReason: "error"`, a rejected prompt, or
 * a v2 idle with an error), so nothing is guessed for them: a harness with no
 * readable transcript answers null and the envelope's verdict stands.
 *
 * The read is a TAIL, not the file: the answer is always the last assistant
 * record, and a session can be tens of megabytes.
 */

import type { HarnessId } from '@kabmo-labs/kabmo-harness-catalog';
import { findSessionFileById } from '@kabmo-labs/kabmo-omp-session-locator';
import { readJsonlTail } from '@kabmo-labs/kabmo-omp-session-messages/jsonl-tail';
import { parseJsonlLenient } from '@kabmo-labs/kabmo-omp-session-core/jsonl';
import { deriveTurnError } from '@kabmo-labs/kabmo-omp-session-parse/turn-error';

/** Enough for the last turn of any real session; a miss falls back to nothing. */
const TAIL_BYTES = 64 * 1024;

/** Harnesses whose transcript Kabmo can read, and therefore trust over the
 *  envelope. `omp-acp` is omp behind the ACP transport. */
const READABLE_TRANSCRIPT: Readonly<Record<string, true>> = { 'omp-acp': true };

export async function transcriptFailure(
  harness: HarnessId | undefined,
  sessionId: string,
): Promise<string | null> {
  if (!harness || READABLE_TRANSCRIPT[harness] !== true || !sessionId) return null;
  try {
    const file = await findSessionFileById(sessionId);
    if (!file) return null;
    const tail = await readJsonlTail(file, TAIL_BYTES, (body) =>
      parseJsonlLenient<Record<string, unknown>>(body),
    );
    for (let index = tail.records.length - 1; index >= 0; index -= 1) {
      const record = tail.records[index] as Record<string, unknown>;
      if (record.type !== 'message') continue;
      const message = record.message;
      if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
      const entry = message as Record<string, unknown>;
      if (entry.role !== 'assistant') continue;
      // The LAST assistant record decides: an earlier failed attempt that was
      // retried into a good answer must not be reported as this turn's ending.
      const error = deriveTurnError(entry);
      const reason = error?.message?.trim();
      if (reason) return reason;
      return null;
    }
    return null;
  } catch {
    // An unreadable transcript is not evidence of a failure.
    return null;
  }
}
