/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A run omp keeps alive across provider retries is CORRECT state — the spinner
 * belongs there — but the timeline said nothing about why nothing was moving,
 * measured over a 2m43s quota wall whose last visible row was the failure.
 */

import { describe, expect, test } from 'bun:test';

import { foldAutoRetry, endRetrySaga, retryNotice, retryVerb } from '@/shared/lib/chat/timeline/provider-retry';
import { setActivity, type OmpAgentFoldDeps } from '@/shared/lib/chat/omp/fold-deps';
import type { ProviderRetryInfo } from '@/shared/types';

/** The two sinks the fold writes to, plus the activity mirror it reads. */
function makeDeps(): { deps: OmpAgentFoldDeps; verbs: string[]; notices: ProviderRetryInfo[] } {
  const verbs: string[] = [];
  const notices: ProviderRetryInfo[] = [];
  const deps = {
    activityRef: { current: '' },
    providerRetryVerbRef: { current: null },
    callbacksRef: {
      current: {
        onActivity: (verb: string) => verbs.push(verb),
        onProviderRetry: (info: ProviderRetryInfo) => notices.push(info),
      },
    },
  } as unknown as OmpAgentFoldDeps;
  return { deps, verbs, notices };
}

describe('retry phrases', () => {
  test('the verb names the attempt and the wait omp announced', () => {
    expect(retryVerb({ attempt: 3, maxAttempts: 10, delayMs: 7000 })).toBe(
      'Retrying after a provider error 3/10 · next in 7s',
    );
  });

  test('a verb stays readable when omp reports only part of it', () => {
    expect(retryVerb({})).toBe('Retrying after a provider error');
    expect(retryVerb({ attempt: 2 })).toBe('Retrying after a provider error 2');
  });

  test('a long wait reads in minutes', () => {
    expect(retryVerb({ attempt: 1, maxAttempts: 3, delayMs: 90_000 })).toContain('next in 1m30s');
    expect(retryVerb({ attempt: 1, maxAttempts: 3, delayMs: 300_000 })).toContain('next in 5m');
  });

  test('the notice carries the budget and the provider message on one line', () => {
    expect(retryNotice({ maxAttempts: 10, errorMessage: '429 Too Many\n   Requests  ' })).toBe(
      'Provider error — omp is retrying (up to 10 attempts). Original: 429 Too Many Requests',
    );
  });

  test('a notice without a provider message still says what is happening', () => {
    expect(retryNotice({})).toBe('Provider error — omp is retrying (automatic retries).');
  });
});

describe('retry fold', () => {
  test('the verb follows every attempt, the notice is written once per saga', () => {
    const { deps, verbs, notices } = makeDeps();
    foldAutoRetry({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 2000 }, deps);
    foldAutoRetry({ type: 'auto_retry_start', attempt: 2, maxAttempts: 3, delayMs: 3000 }, deps);
    foldAutoRetry({ type: 'auto_retry_start', attempt: 3, maxAttempts: 3, delayMs: 4000 }, deps);
    expect(verbs).toEqual([
      'Retrying after a provider error 1/3 · next in 2s',
      'Retrying after a provider error 2/3 · next in 3s',
      'Retrying after a provider error 3/3 · next in 4s',
    ]);
    expect(notices.map((info) => info.attempt)).toEqual([1]);
  });

  test('a saga that restarts (a budget reset) writes its own notice', () => {
    const { deps, notices } = makeDeps();
    foldAutoRetry({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3 }, deps);
    foldAutoRetry({ type: 'auto_retry_end', success: false, attempt: 3 }, deps);
    foldAutoRetry({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3 }, deps);
    expect(notices).toHaveLength(2);
  });

  test('the saga ending drops the retry phrase instead of leaving a stale wait', () => {
    const { deps, verbs } = makeDeps();
    foldAutoRetry({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 2000 }, deps);
    foldAutoRetry({ type: 'auto_retry_end', success: true, attempt: 1 }, deps);
    expect(verbs.at(-1)).toBe('Thinking');
  });

  test('the phrase outranks the activity the doomed attempt itself names', () => {
    const { deps, verbs } = makeDeps();
    foldAutoRetry({ type: 'auto_retry_start', attempt: 2, maxAttempts: 3, delayMs: 4000 }, deps);
    // The next attempt's own frames ("Thinking…" on turn_start) must not replace
    // the retry phrase — that switch is what made a live saga unreadable.
    setActivity('Thinking', deps);
    expect(deps.activityRef.current).toBe('Retrying after a provider error 2/3 · next in 4s');
    expect(verbs.at(-1)).toBe('Retrying after a provider error 2/3 · next in 4s');
  });

  test('a direct write by the run-start callback cannot leave the generic phrase', () => {
    const { deps, verbs } = makeDeps();
    foldAutoRetry({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 4000 }, deps);
    // `handleAgentStart` publishes "Thinking…" straight to the timeline without
    // touching the mirror, so the mirror holds the phrase while the screen does
    // not: "no change" here would mean "do nothing" and the phrase was lost.
    deps.activityRef.current = 'Thinking';
    setActivity('Thinking', deps);
    expect(verbs.at(-1)).toBe('Retrying after a provider error 1/3 · next in 4s');
  });

  test('a run that ends without auto_retry_end still clears the phrase', () => {
    const { deps } = makeDeps();
    foldAutoRetry({ type: 'auto_retry_start', attempt: 3, maxAttempts: 3, delayMs: 4000 }, deps);
    endRetrySaga(deps);
    expect(deps.providerRetryVerbRef.current).toBeNull();
    expect(deps.activityRef.current).toBe('Thinking');
  });
});
