/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The toast queue: one page-level list, deduplicated, bounded, and with a delay
 * resolved once at push time.
 *
 * The bugs these cases pin:
 *
 * - Every host used to own a private array, so two surfaces raising a toast at
 *   the same moment printed two cards in the same corner. The queue is module
 *   state now, and `getToastsSnapshot` is the single source.
 * - The same sentence pushed twice stacked two identical cards. It replaces.
 * - The list grew without limit; a loop of failures became a wall. Three.
 * - A duration the caller never asked for was a flat 4000; the policy decides
 *   and the resolved number rides on the entry, so every renderer agrees.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  dismissToast,
  getToastsSnapshot,
  pushToast,
  resetToasts,
  subscribeToasts,
} from '@/client/hooks/ui/toasts';
import { toastDurationMs } from '@/shared/lib/ui/toast-duration';

afterEach(() => resetToasts());

describe('toast queue', () => {
  test('pushes in order with monotonically increasing ids', () => {
    pushToast('first', 'success');
    pushToast('second', 'error');
    const queue = getToastsSnapshot();
    expect(queue.map((toast) => [toast.message, toast.type])).toEqual([
      ['first', 'success'],
      ['second', 'error'],
    ]);
    expect(queue[1]!.id).toBeGreaterThan(queue[0]!.id);
  });

  test('defaults to an error tone', () => {
    pushToast('something broke');
    expect(getToastsSnapshot()[0]!.type).toBe('error');
  });

  test('the delay is resolved at push and matches the policy', () => {
    pushToast('Saved', 'success');
    expect(getToastsSnapshot()[0]!.duration).toBe(toastDurationMs({ tone: 'success', message: 'Saved' }));
  });

  test('an empty message is refused rather than drawn as a blank card', () => {
    pushToast('   ');
    expect(getToastsSnapshot()).toHaveLength(0);
  });

  test('a repeated sentence replaces its own card instead of stacking a copy', () => {
    pushToast('Provider list refreshed', 'success');
    const [first] = getToastsSnapshot();
    pushToast('Provider list refreshed', 'success');
    const queue = getToastsSnapshot();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.id).toBeGreaterThan(first!.id);
  });

  test('the same words in a different tone are two different messages', () => {
    pushToast('Check the log', 'success');
    pushToast('Check the log', 'error');
    expect(getToastsSnapshot()).toHaveLength(2);
  });

  test('a toast carrying an action is never replaced by a plain repeat', () => {
    const action = { label: 'Send now', onClick: () => {} };
    pushToast('Stopped.', 'success', { action });
    pushToast('Stopped.', 'success');
    expect(getToastsSnapshot()).toHaveLength(2);
  });

  test('an action toast waits for the decision', () => {
    pushToast('Stopped.', 'success', { action: { label: 'Send now', onClick: () => {} } });
    expect(getToastsSnapshot()[0]!.duration).toBeNull();
  });

  test('the list is bounded: the oldest card falls off', () => {
    for (let i = 0; i < 6; i += 1) pushToast(`message ${i}`, 'success');
    expect(getToastsSnapshot().map((toast) => toast.message)).toEqual([
      'message 3',
      'message 4',
      'message 5',
    ]);
  });

  test('dismiss removes only the matching id and keeps the rest in order', () => {
    pushToast('a', 'success');
    pushToast('b', 'success');
    pushToast('c', 'success');
    const middle = getToastsSnapshot()[1]!.id;
    dismissToast(middle);
    expect(getToastsSnapshot().map((toast) => toast.message)).toEqual(['a', 'c']);

    // An id that is not present is a no-op, not a wipe.
    dismissToast(9_999_999);
    expect(getToastsSnapshot().map((toast) => toast.message)).toEqual(['a', 'c']);
  });

  test('a subscriber hears every real change and nothing else', () => {
    let changes = 0;
    const unsubscribe = subscribeToasts(() => { changes += 1; });

    pushToast('a', 'success');
    expect(changes).toBe(1);

    pushToast('a', 'success'); // replace is still a change
    expect(changes).toBe(2);

    dismissToast(9_999_999); // absent id: no change
    expect(changes).toBe(2);

    unsubscribe();
    pushToast('b', 'success');
    expect(changes).toBe(2);
  });
});
