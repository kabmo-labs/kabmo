/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a transcript read drops before it reaches a card.
 *
 * omp 18.17.0 writes its embedded shell's trace into the JSONL beside the `bash`
 * result (measured: a 201 KB trace for `seq 1 30000`, its `history` a second
 * copy of the output). A reload is the one path that reads those bytes back, so
 * it is the one place the field has to go — see
 * `shared/lib/omp/session/shell-trace.ts`.
 *
 * Split from `messages-map.test.ts`, which sits at the repo's per-file ceiling;
 * the sibling `messages-map-pending.test.ts` follows the same split.
 */

import { describe, expect, test } from 'bun:test';
import { collectToolOutputs } from '@/shared/lib/omp/session/messages-map';

const result = (callId: string, text: string, details: Record<string, unknown>) => ({
  type: 'message',
  message: { role: 'toolResult', toolCallId: callId, content: [{ type: 'text', text }], details },
});

describe('collectToolOutputs — the shell trace', () => {
  test('drops `details.trace` and keeps every other field', () => {
    const outputs = collectToolOutputs([
      result('c', 'out', {
        exitCode: 0,
        trace: { v: 1, seq: 9, units: [], history: [{ kind: 'RunStart' }] },
      }),
    ]);
    expect(outputs.get('c')?.details).toEqual({ exitCode: 0 });
  });

  test('leaves a result with no trace alone', () => {
    const outputs = collectToolOutputs([result('c', 'out', { exitCode: 0, wallTimeMs: 12 })]);
    expect(outputs.get('c')?.details).toEqual({ exitCode: 0, wallTimeMs: 12 });
  });
});