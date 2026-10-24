/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `runIsOver` — the verdict a reattached client asks before settling a run it
 * was following. Every case here is a shape the server really produces:
 *
 * - `running:false` is the answer for a session this process does not manage
 *   (and for one whose child is gone): the run is over, whatever the local
 *   generating flag still believes;
 * - `busy` with no run is NOT over — the server sets it for work a probe would
 *   queue behind (a live subagent whose parent turn ended, a parked dialog);
 * - a live `isStreaming`/`isPromptRunning` is NOT over;
 * - no answer at all (a failed request) is NOT a verdict.
 *
 * The asymmetry is deliberate: settling a run that is still going throws away
 * the streaming answer, while missing a settle costs a reload.
 */

import { describe, expect, test } from 'bun:test';
import { runIsOver } from '@/client/hooks/chat/omp/run-liveness';

describe('runIsOver', () => {
  test('a session this process does not run is over', () => {
    expect(runIsOver({ running: false })).toBe(true);
  });

  test('no answer is not a verdict', () => {
    expect(runIsOver(null)).toBe(false);
    expect(runIsOver(undefined)).toBe(false);
  });

  test('a busy session with no run in flight is NOT over', () => {
    // A live subagent whose parent turn ended, or a dialog a reloaded client
    // has not answered: settling here would abandon the work still running.
    expect(runIsOver({ running: true, busy: true, state: { isStreaming: false, isPromptRunning: false } })).toBe(false);
  });

  test('a streaming or prompting run is NOT over', () => {
    expect(runIsOver({ running: true, state: { isStreaming: true, isPromptRunning: false } })).toBe(false);
    expect(runIsOver({ running: true, state: { isStreaming: false, isPromptRunning: true } })).toBe(false);
  });

  test('omp\'s verdict is REQUIRED: a child with nothing streaming is not enough', () => {
    // A turn can be admitted but not yet streaming, and a build that does not
    // report `isSettled` cannot tell us which. The server refuses to settle on
    // anything but `isSettled === true` (`RunSettle`), so this must too —
    // otherwise the client reloads a transcript the server still considers live.
    expect(runIsOver({ running: true, state: { isStreaming: false, isPromptRunning: false } })).toBe(false);
    expect(runIsOver({ running: true, state: { isStreaming: false, isPromptRunning: false, isSettled: true } })).toBe(true);
  });

  test('omp\'s own quiescence verdict decides when it is present', () => {
    expect(runIsOver({ running: true, state: { isSettled: true } })).toBe(true);
    // omp says something is still admitted/scheduled/queued: a retry wait, a
    // background job. Not over.
    expect(runIsOver({ running: true, state: { isSettled: false } })).toBe(false);
  });

  test('a payload with no state is not read as settled', () => {
    expect(runIsOver({ running: true })).toBe(false);
  });

  test('a queued follow-up keeps the session open even when it reads settled', () => {
    // omp will wake again, so this is not a finished run: settling would reload
    // the transcript while the next turn is about to open.
    expect(runIsOver({ running: true, state: { isSettled: true, queuedMessageCount: 1 } })).toBe(false);
  });
});
