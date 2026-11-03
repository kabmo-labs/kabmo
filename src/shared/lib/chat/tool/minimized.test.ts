/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shell minimizer's record on a `bash` result (omp 18.16.0).
 *
 * The fixture is verbatim from a real child: `git --no-pager log` in a 60-commit
 * repo answered a `bash` RPC with
 *
 *   details: { wallTimeMs: …, meta: { minimized: { filter: 'git',
 *              inputBytes: 10970, outputBytes: 3905, artifactId: '0' } } }
 *
 * and wrote the lossless original to `<sessionId>/0.bash-original.log`. The
 * reloaded transcript carries the same record, so both paths are pinned.
 *
 * Pure function, no mounting.
 */

import { describe, expect, test } from 'bun:test';
import { minimizedLabel, minimizedOutputOf } from '@/shared/lib/chat/tool/minimized';
import { artifactRefOf } from '@/shared/lib/chat/tool/artifact';
import type { ToolCallData } from '@/shared/types/chat';

function tool(partial: Partial<ToolCallData> & Pick<ToolCallData, 'type'>): ToolCallData {
  return { id: 'c1', name: partial.type, title: partial.type, ...partial } as ToolCallData;
}

const RECORD = { filter: 'git', inputBytes: 10970, outputBytes: 3905, artifactId: '0' };

describe('minimizedOutputOf', () => {
  test('reads the record a real bash result carries', () => {
    expect(minimizedOutputOf(tool({ type: 'bash', details: { meta: { minimized: RECORD } } }))).toEqual({
      filter: 'git',
      inputBytes: 10970,
      outputBytes: 3905,
      artifactId: '0',
    });
  });

  test('states the rewrite without the artifact when omp saved none', () => {
    const { artifactId, ...noArtifact } = RECORD;
    expect(minimizedOutputOf(tool({ type: 'bash', details: { meta: { minimized: noArtifact } } })))
      .toEqual({ filter: 'git', inputBytes: 10970, outputBytes: 3905 });
    expect(artifactId).toBe('0');
  });

  test('returns null for a result the minimizer left alone', () => {
    expect(minimizedOutputOf(tool({ type: 'bash', details: { meta: { limits: {} }, wallTimeMs: 12 } }))).toBeNull();
    expect(minimizedOutputOf(tool({ type: 'bash', details: { wallTimeMs: 12 } }))).toBeNull();
    expect(minimizedOutputOf(tool({ type: 'bash' }))).toBeNull();
  });

  test('refuses a record missing either size, which could only be guessed', () => {
    // "→ 0 B" is a claim about a number omp did not send; the card says nothing
    // instead.
    expect(minimizedOutputOf(tool({ type: 'bash', details: { meta: { minimized: { filter: 'git', inputBytes: 100 } } } }))).toBeNull();
    expect(minimizedOutputOf(tool({ type: 'bash', details: { meta: { minimized: { filter: 'git', outputBytes: 10 } } } }))).toBeNull();
    expect(minimizedOutputOf(tool({ type: 'bash', details: { meta: { minimized: { inputBytes: 1, outputBytes: 0 } } } }))).toBeNull();
  });

  test('labels the filter and both sizes', () => {
    expect(minimizedLabel({ filter: 'git', inputBytes: 10970, outputBytes: 3905 })).toBe('git 10.7 KB → 3.8 KB');
  });
});

describe('artifactRefOf — the minimizer original', () => {
  test('points at the bash-original file and states the bytes it saved', () => {
    // The inline body is the REWRITE; `bash-original` holds what the command
    // actually printed, so the chip must probe that kind, not `bash`.
    expect(artifactRefOf(tool({ type: 'bash', details: { meta: { minimized: RECORD } } }))).toEqual({
      id: '0',
      kind: 'bash-original',
      elidedBytes: 10970 - 3905,
    });
  });

  test('wins over a truncation record on the same result', () => {
    const ref = artifactRefOf(tool({
      type: 'bash',
      details: {
        meta: {
          minimized: RECORD,
          limits: { columnTruncated: { maxColumn: 768, unit: 'bytes', artifactId: '9' } },
        },
      },
    }));
    expect(ref).toEqual({ id: '0', kind: 'bash-original', elidedBytes: 7065 });
  });

  test('refuses a non-numeric minimizer id, which could never name a file', () => {
    expect(artifactRefOf(tool({
      type: 'bash',
      details: { meta: { minimized: { ...RECORD, artifactId: '../../etc/passwd' } } },
    }))).toBeNull();
  });
});
