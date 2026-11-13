/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The installer every DOM suite shares has to be a PAIR-wise swap.
 *
 * `installDomGlobals` exists because a suite that keeps its own save-and-restore
 * loop captures whatever the previous file left behind and then restores the
 * leak. The property that makes a dispatch work is narrower still: `Event` and
 * `EventTarget` are one realm. Installing the constructor without the target it
 * belongs to is what made the Ubuntu gate throw
 * `Argument 1 ('event') to EventTarget.dispatchEvent must be an instance of
 * Event` in a suite that names neither the installer nor the component.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const nativeEvent = globalThis.Event;
const nativeEventTarget = globalThis.EventTarget;

afterAll(() => {
  restoreDomGlobals();
});

describe('installDomGlobals', () => {
  test('installs Event and EventTarget from the same window, so a dispatch works', () => {
    const win = new Window({ url: 'http://localhost' });
    installDomGlobals(win);

    expect(globalThis.Event).toBe(win.Event as unknown as typeof Event);
    expect(globalThis.EventTarget).toBe(win.EventTarget as unknown as typeof EventTarget);
    // The point of the pair: the runner's target would refuse this event.
    expect(() => {
      new EventTarget().dispatchEvent(new Event('probe'));
    }).not.toThrow();
  });

  test('restores the runner’s own constructors, never deletes them', () => {
    installDomGlobals(new Window({ url: 'http://localhost' }));
    restoreDomGlobals();

    expect(globalThis.Event).toBe(nativeEvent);
    expect(globalThis.EventTarget).toBe(nativeEventTarget);
    expect(() => {
      new EventTarget().dispatchEvent(new Event('probe'));
    }).not.toThrow();
  });
});
