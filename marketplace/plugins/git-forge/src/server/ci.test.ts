/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The CI roll-up, which is the one place a wrong word paints a wrong colour.
 *
 * Each case is a host state that exists and that a naive mapping would get
 * wrong: a run in flight has no `conclusion`, a skipped job is not a failure, and
 * an unrecognized word must not turn red.
 */

import { describe, expect, test } from 'bun:test';

import { ciBadge, ciStateOf, githubChecks, githubStatus, worstCi } from './ci';

describe('ciStateOf', () => {
  test('each host vocabulary maps to the same four states', () => {
    expect(ciStateOf('success')).toBe('success');
    expect(ciStateOf('SUCCESSFUL')).toBe('success');
    expect(ciStateOf('failed')).toBe('failure');
    expect(ciStateOf('timed_out')).toBe('failure');
    expect(ciStateOf('in_progress')).toBe('pending');
    expect(ciStateOf('waiting_for_resource')).toBe('pending');
    expect(ciStateOf('skipped')).toBe('neutral');
    expect(ciStateOf('canceled')).toBe('neutral');
    expect(ciStateOf('canceled')).toBe(ciStateOf('cancelled'));
  });

  test('a word nobody recognizes is neutral, never a failure', () => {
    expect(ciStateOf('brand_new_state')).toBe('neutral');
    expect(ciStateOf('')).toBe('neutral');
    expect(ciStateOf(null)).toBe('neutral');
  });
});

describe('worstCi', () => {
  test('one failing job fails the roll-up', () => {
    expect(worstCi(['success', 'success', 'failure'])).toBe('failure');
    expect(worstCi(['success', 'pending'])).toBe('pending');
    expect(worstCi(['neutral', 'success'])).toBe('neutral');
    expect(worstCi([])).toBeNull();
  });
});

describe('ciBadge', () => {
  test('one run is named by the host word, several by the count', () => {
    expect(ciBadge(['success'], 'u')).toEqual({ state: 'success', label: 'success', url: 'u' });
    expect(ciBadge(['success', 'failure'], 'u')?.label).toBe('2 checks');
  });

  test('no states is no badge, not a neutral one', () => {
    expect(ciBadge([], 'u')).toBeNull();
    expect(ciBadge([null, ''], 'u')).toBeNull();
  });
});

describe('githubChecks', () => {
  test('a run in flight is pending even with no conclusion', () => {
    const payload = {
      check_runs: [
        { name: 'test', status: 'completed', conclusion: 'success' },
        { name: 'lint', status: 'in_progress', conclusion: null },
      ],
    };
    expect(githubChecks(payload, null)).toEqual({ state: 'pending', label: '2 checks', url: null });
  });

  test('an empty run list is no badge', () => {
    expect(githubChecks({ check_runs: [] }, null)).toBeNull();
    expect(githubChecks({}, null)).toBeNull();
    expect(githubChecks(null, null)).toBeNull();
  });

  test('a cancelled run does not fail the pipeline', () => {
    expect(githubChecks({ check_runs: [{ status: 'completed', conclusion: 'cancelled' }] }, null)?.state).toBe(
      'neutral',
    );
  });
});

describe('githubStatus', () => {
  test('a combined status is one word', () => {
    expect(githubStatus({ state: 'failure' }, 'u')).toEqual({ state: 'failure', label: 'failure', url: 'u' });
    expect(githubStatus({}, null)).toBeNull();
  });
});
