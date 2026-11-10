/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The idle ladder omp 18.17.0 gives a blocking `wait`, read from the prose it
 * answers with: the window this call ran, and — from the second back-to-back
 * idle wait on — the running total across the streak.
 */

import { describe, expect, test } from 'bun:test';
import { WAIT_LADDER_MS, waitIdleLabel, waitIdleOf } from '@/shared/lib/omp/session/wait-idle';

describe('the idle ladder', () => {
  test('mirrors the windows omp 18.17.0 gives a blocking wait', () => {
    // The 30-minute cap is GONE: a wait returns when its window elapses, and the
    // window climbs one rung for each back-to-back idle wait.
    expect([...WAIT_LADDER_MS]).toEqual([5_000, 10_000, 30_000, 60_000, 300_000]);
  });

  test('reads the window omp names on a first idle return', () => {
    // The FIRST rung carries no notice, only its own sentence.
    expect(waitIdleOf('No reply within 5.0s.')).toEqual({ windowMs: 5_000 });
    expect(waitIdleOf('No service finished within 30s. Read proc:// for status.')).toEqual({ windowMs: 30_000 });
  });

  test('reads the 18.18.6 sentence, which names the next rung instead of ending', () => {
    // 18.18.6 appends a back-to-back hint after a semicolon, and words a
    // timeout that watched jobs the same way (`No job finished …`). A regex
    // demanding the period stopped matching, so both cards lost the idle chip.
    expect(waitIdleOf('No reply within 5.0s; a back-to-back wait allows up to 10s.')).toEqual({ windowMs: 5_000 });
    expect(waitIdleOf('No service finished within 10s; a back-to-back wait allows up to 30s. Read proc:// for status.'))
      .toEqual({ windowMs: 10_000 });
    expect(waitIdleOf('1 background job still running.\n\nNo job finished within 30s; a back-to-back wait allows up to 60s.'))
      .toEqual({ windowMs: 30_000 });
  });

  test('reads the streak omp names from the second idle wait on', () => {
    // `WAIT_NOTICE_RUNG` appends the notice whose span is the RUNNING TOTAL:
    // 5 s + 10 s, then + 30 s, then + 60 s, then + 300 s.
    expect(waitIdleOf('Nothing new after 15.0s of back-to-back waits. Waiting is not progress: …'))
      .toEqual({ streakMs: 15_000 });
    expect(waitIdleOf('Nothing new after 1m45s of back-to-back waits. …')).toEqual({ streakMs: 105_000 });
  });

  test('a settle is not an idle return', () => {
    expect(waitIdleOf('A service finished. Read proc:// for its status and output.')).toBeUndefined();
    expect(waitIdleOf('1\n2\n3')).toBeUndefined();
    expect(waitIdleOf(undefined)).toBeUndefined();
  });

  test('labels the rung, or the streak once omp states it', () => {
    expect(waitIdleLabel({ windowMs: 10_000 })).toBe('idle 10s');
    expect(waitIdleLabel({ streakMs: 45_000 })).toBe('idle 45s total');
    expect(waitIdleLabel({})).toBe('idle');
  });
});
