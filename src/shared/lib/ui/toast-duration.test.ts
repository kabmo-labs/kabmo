/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The auto-dismiss budget.
 *
 * The bug this pins: one flat 4000 ms made a two-word confirmation linger and a
 * refused action vanish before it could be read. The cases below are the
 * contract — a floor so nothing flickers, a rate so a longer sentence gets more
 * time, a ceiling so a paragraph does not sit there, and a caller's own number
 * winning over all of it.
 */

import { describe, expect, test } from 'bun:test';
import { TOAST_EXIT_MS, toastDurationMs, updateOutcomeTone } from '@/shared/lib/ui/toast-duration';

describe('toastDurationMs', () => {
  test('a short confirmation gets the success floor, not a flicker', () => {
    expect(toastDurationMs({ tone: 'success', message: 'Saved' })).toBe(3000);
  });

  test('a short error still gets the error floor: a failure is read twice', () => {
    expect(toastDurationMs({ tone: 'error', message: 'Failed' })).toBe(5000);
  });

  test('a longer sentence buys reading time, measured from its own length', () => {
    const short = toastDurationMs({ tone: 'success', message: 'Saved' })!;
    const long = toastDurationMs({
      tone: 'success',
      message: 'Provider list refreshed — 97 providers, all readable.',
    })!;
    expect(long).toBeGreaterThan(short);
  });

  test('an error outlasts a success of the same length', () => {
    const message = 'Could not read the provider list — omp may still be starting.';
    expect(toastDurationMs({ tone: 'error', message })).toBeGreaterThan(
      toastDurationMs({ tone: 'success', message })!,
    );
  });

  test('a paragraph is clamped instead of sitting for a minute', () => {
    const message = 'x'.repeat(4000);
    expect(toastDurationMs({ tone: 'success', message })).toBe(8000);
    expect(toastDurationMs({ tone: 'error', message })).toBe(12000);
  });

  test('an explicit duration is honoured verbatim, zero included', () => {
    expect(toastDurationMs({ tone: 'error', message: 'boom', explicit: 7000 })).toBe(7000);
    expect(toastDurationMs({ tone: 'error', message: 'boom', explicit: 0 })).toBe(0);
  });

  test('an explicit null waits for a dismissal', () => {
    expect(toastDurationMs({ tone: 'success', message: 'Saved', explicit: null })).toBeNull();
  });

  test('a toast with an action is sticky unless the caller says otherwise', () => {
    expect(toastDurationMs({ tone: 'error', message: 'Stopped.', sticky: true })).toBeNull();
    expect(toastDurationMs({ tone: 'error', message: 'Stopped.', sticky: true, explicit: 8000 })).toBe(8000);
  });

  test('surrounding whitespace does not buy time', () => {
    expect(toastDurationMs({ tone: 'success', message: '  Saved  ' })).toBe(
      toastDurationMs({ tone: 'success', message: 'Saved' })!,
    );
  });

  test('a warning outlasts a confirmation and gives way to a failure', () => {
    const message = 'Merging feature stopped on a conflict; resolve it above.';
    expect(toastDurationMs({ tone: 'warning', message })).toBeGreaterThan(
      toastDurationMs({ tone: 'success', message })!,
    );
    expect(toastDurationMs({ tone: 'warning', message })).toBeLessThan(
      toastDurationMs({ tone: 'error', message })!,
    );
  });

  test('the exit animation is a real duration, short enough to read as a fade', () => {
    expect(TOAST_EXIT_MS).toBeGreaterThan(0);
    expect(TOAST_EXIT_MS).toBeLessThan(400);
  });
});

describe('updateOutcomeTone', () => {
  test('a run that finished is a success', () => {
    expect(updateOutcomeTone({ success: true, manual: false })).toBe('success');
  });

  test('a run the environment cannot perform is a warning: the user still has to act', () => {
    expect(updateOutcomeTone({ success: true, manual: true })).toBe('warning');
  });

  test('a failed run is an error, even when it also names a manual command', () => {
    expect(updateOutcomeTone({ success: false, manual: true })).toBe('error');
  });
});
