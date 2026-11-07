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
  /** Blocks the send control, as an empty draft does. */
  sendDisabled?: boolean;
}

const MODES = {
  plan: false,
  goal: false,
  goalOpen: false,
  goalRecord: null,
  goalContinuation: null,
  goalEvaluating: false,
  goalArm: null,
  disarmGoal: () => {},
  pending: false,
  planAvailable: true,
  goalAvailable: true,
  error: null,
  clearError: () => {},
  onTogglePlan: () => {},
  onGoalAction: async () => ({ ok: true }),
};

/** The selectors are off: this file is about the right-hand action strip. */
async function mount({ isGenerating, chatRunning, isMobile = false, onStop, withModes = false, sendDisabled = false }: MountOptions): Promise<HTMLElement> {
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
        sendDisabled,
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
 * The action pair's contract, as the UI states it: one geometry for both
 * controls, an accessible name on each, and a disabled send that still reports
 * what it is. None of this is cosmetic — the pair had no `focus-visible`
 * treatment at all and the square relied on `title` alone for its name, which
 * is not a reliable accessible name across screen readers.
 */
describe('composer toolbar action pair', () => {
  const send = '[aria-label="Send message"], [aria-label="Queue follow-up message"]';

  test('names Stop for assistive tech, not only for a tooltip', async () => {
    const el = await mount({ isGenerating: true });
    const stop = el.querySelector(stops) as HTMLButtonElement;
    expect(stop.getAttribute('aria-label')).toBe('Stop generation');
  });

  test('gives both controls the same box on a desktop', async () => {
    const el = await mount({ isGenerating: true, onStop: () => {} });
    const stop = el.querySelector(stops) as HTMLButtonElement;
    const submit = el.querySelector(send) as HTMLButtonElement;
    for (const box of ['w-7', 'h-7', 'rounded-lg']) {
      expect(stop.className.split(/\s+/)).toContain(box);
      expect(submit.className.split(/\s+/)).toContain(box);
    }
  });

  test('gives both controls the same box on a phone', async () => {
    const el = await mount({ isGenerating: true, isMobile: true, onStop: () => {} });
    const stop = el.querySelector(stops) as HTMLButtonElement;
    const submit = el.querySelector(send) as HTMLButtonElement;
    for (const box of ['w-8', 'h-8', 'rounded-lg']) {
      expect(stop.className.split(/\s+/)).toContain(box);
      expect(submit.className.split(/\s+/)).toContain(box);
    }
  });

  test('keeps Send usable and labelled while nothing is typed', async () => {
    const el = await mount({ isGenerating: false });
    const submit = el.querySelector(send) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(submit.getAttribute('title')).toBe('Send message');
  });

  test('states the queue action once a run is in flight', async () => {
    const el = await mount({ isGenerating: false, chatRunning: true });
    const submit = el.querySelector('[aria-label="Queue follow-up message"]') as HTMLButtonElement;
    expect(submit).not.toBeNull();
    expect(submit.disabled).toBe(false);
  });

  test('renders a disabled Send as disabled, with no hover lift', async () => {
    const el = await mount({ isGenerating: false, sendDisabled: true });
    const submit = el.querySelector(send) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // The fill changes through a solved hover TOKEN, so the disabled state has
    // to re-state the resting fill and the 40%: otherwise a barred control
    // would darken on hover like a live one.
    const classes = submit.className.split(/\s+/);
    expect(classes).toContain('disabled:opacity-40');
    expect(classes).toContain('disabled:hover:bg-info-text');
    expect(classes).toContain('disabled:shadow-none');
  });

  test('paints Stop red and Send blue, so the two ends of a turn differ before the glyph is read', async () => {
    const el = await mount({ isGenerating: true, onStop: () => {} });
    const stop = el.querySelector(stops) as HTMLButtonElement;
    const submit = el.querySelector(send) as HTMLButtonElement;
    // `-text` is the palette's hex SOLVED to 4.5:1 against paper and canvas;
    // the raw `bg-error`/`bg-info` is a chip ground and measures 2.73:1 and
    // 1.94:1 on the worst palettes, so a control the user has to find cannot
    // use it. On the solved fill `text-canvas` reads 4.50:1 minimum — measured
    // over all 63 palettes.
    expect(stop.className.split(/\s+/)).toContain('bg-error-text');
    expect(submit.className.split(/\s+/)).toContain('bg-info-text');
    expect(stop.className.split(/\s+/)).toContain('text-canvas');
    expect(submit.className.split(/\s+/)).toContain('text-canvas');
    // Neither is an outline any more: one geometry, one filled control per
    // action. A leftover border would draw a second edge on a filled box.
    expect(stop.className).not.toContain('border-');
    expect(submit.className).not.toContain('bg-ink');
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
