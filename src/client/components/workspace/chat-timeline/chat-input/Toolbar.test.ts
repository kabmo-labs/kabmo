/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Stop visibility on the composer toolbar.
 *
 * Stop follows the CHAT-level "a run is in flight" flag — the server-tracked
 * `stream` status OR this client's own run — never `isGenerating` alone. A run
 * this page did not start (another tab on the same session, a scheduled task,
 * the goal driver's continuation, a page that reattached to the stream) is
 * still running, and the sidebar spinner and the docked indicator already say
 * so; reading the local flag alone hid Stop for exactly those runs, leaving
 * the only control that ends a turn unavailable while it streamed.
 *
 * The fallback is the other half: a composer with no chat turn of its own (the
 * New Chat modal, the side-question form) passes no chat-level flag and must
 * keep behaving as it did.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ComposerToolbar } from '@/client/components/workspace/chat-timeline/chat-input/Toolbar';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

/**
 * The SHARED DOM helpers, and an unmount between cases.
 *
 * A local `nativeGlobals` map is unsafe here for the reason `pristine-globals.ts`
 * states: Bun imports every file before any test runs, so the capture can hold
 * another suite's window. And a tree left mounted across `afterAll` lets a
 * deferred Preact flush land after the globals are gone — measured on the
 * Windows gate as `ReferenceError: document is not defined` between tests in the
 * file that ran next.
 */
beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  render(null, container);
  container?.remove();
  restoreDomGlobals();
});

afterAll(() => restoreDomGlobals());

interface MountOptions {
  isGenerating: boolean;
  chatRunning?: boolean;
  isMobile?: boolean;
  onStop?: () => void;
  /** Renders the Plan/Goal group when supplied. */
  withModes?: boolean;
}

const MODES = {
  plan: false,
  goal: false,
  goalOpen: false,
  goalRecord: null,
  goalContinuation: null,
  goalEvaluating: false,
  pending: false,
  planAvailable: true,
  error: null,
  clearError: () => {},
  onTogglePlan: () => {},
  onGoalAction: () => {},
};

/** The selectors are off: this file is about the right-hand action strip. */
async function mount({ isGenerating, chatRunning, isMobile = false, onStop, withModes = false }: MountOptions): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(ComposerToolbar, {
        isMobile,
        selectedModel: null,
        onSelectModel: () => {},
        thinkingLevels: [],
        currentThinking: 'auto',
        onSelectThinking: () => {},
        isGenerating,
        chatRunning,
        onStop,
        onSend: () => {},
        sendDisabled: false,
        showModel: false,
        showThinking: false,
        showAccess: withModes,
        modes: withModes ? MODES : undefined,
        onOpenGoal: withModes ? () => {} : undefined,
      }),
      container,
    );
  });
  return container;
}

const stops = '[title="Stop generation"]';

describe('composer toolbar Stop', () => {
  test('offers Stop for a run only the chat-level flag reports', async () => {
    const el = await mount({ isGenerating: false, chatRunning: true });
    expect(el.querySelectorAll(stops).length).toBe(1);
  });

  test('offers no Stop while the chat is idle', async () => {
    const el = await mount({ isGenerating: false, chatRunning: false });
    expect(el.querySelectorAll(stops).length).toBe(0);
  });

  test('falls back to the local flag for a composer with no chat turn', async () => {
    const el = await mount({ isGenerating: true });
    expect(el.querySelectorAll(stops).length).toBe(1);
  });

  test('keeps Stop off a phone composer that has no stop handler', async () => {
    const el = await mount({ isGenerating: true, chatRunning: true, isMobile: true, onStop: undefined });
    expect(el.querySelectorAll(stops).length).toBe(0);
  });
});

/**
 * Where the Plan/Goal group is drawn. The bottom row is a single line whose
 * left cluster already fills it on a 320px phone, so a third group there
 * pushed the voice button under the model label; the attachment row above has
 * a second line of room. Desktop keeps the group where it has always been.
 */
describe('composer toolbar Plan/Goal host', () => {
  const plan = '[aria-label="Enter plan mode"]';
  const goal = '[aria-label="Set a goal"]';

  test('draws the toggles in the bottom row on a desktop', async () => {
    const el = await mount({ isGenerating: false, isMobile: false, withModes: true });
    expect(el.querySelectorAll(plan).length).toBe(1);
    expect(el.querySelectorAll(goal).length).toBe(1);
  });

  test('leaves the phone bottom row without them, for the attachment row to host', async () => {
    const el = await mount({ isGenerating: false, isMobile: true, withModes: true });
    expect(el.querySelectorAll(plan).length).toBe(0);
    expect(el.querySelectorAll(goal).length).toBe(0);
  });

  test('draws neither when the composer has no modes at all', async () => {
    const el = await mount({ isGenerating: false, withModes: false });
    expect(el.querySelectorAll(plan).length).toBe(0);
  });
});
