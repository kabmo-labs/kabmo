/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two mode buttons.
 *
 * What these pin is the accessibility contract the editor and diff toolbars
 * already follow: a control that exists only as an `<svg onClick>` is
 * unreachable by keyboard and invisible to a screen reader, and a toggle whose
 * pressed state is carried only by colour cannot be read at all.
 *
 * Rendered with `h()` (no JSX) against happy-dom, the same way
 * `RightActivityBar.test.ts` does.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { ModeToggles, type ModeTogglesProps } from '@/client/components/workspace/chat-timeline/chat-input/ModeToggles';
import type { GoalRecord } from '@/shared/lib/omp/mode/types';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

/**
 * The SHARED DOM helpers, not a local save-and-restore map.
 *
 * `pristine-globals.ts` states why: Bun imports every file before any test
 * runs, so a local `nativeGlobals` capture records whatever another suite had
 * installed by then, and restoring it hands the next file a dead window. This
 * file also never unmounted its last tree, so a component stayed mounted across
 * `afterAll` — and a Preact flush that landed afterwards threw
 * `ReferenceError: document is not defined` between the NEXT file's tests
 * (measured on the Windows gate, which reports it as an `error`, not a failure).
 */
beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
});

afterAll(() => restoreDomGlobals());

function paint(overrides: Partial<ModeTogglesProps> = {}): HTMLElement {
  const props: ModeTogglesProps = {
    plan: false,
    goal: false,
    goalArm: null,
    goalRecord: null,
    pending: false,
    onTogglePlan: () => {},
    onOpenGoal: () => {},
    planAvailable: true,
    goalAvailable: true,
    ...overrides,
  };
  if (container) render(null, container);
  render(h(ModeToggles, props), container);
  return container;
}

const goalRecord: GoalRecord = {
  id: 'g1',
  objective: 'x',
  status: 'active',
  tokenBudget: 200000,
  tokensUsed: 50000,
  timeUsedSeconds: 10,
  createdAt: 0,
  updatedAt: 0,
};

describe('ModeToggles', () => {
  test('both buttons carry a label, a title and a pressed state', () => {
    const el = paint({ plan: true });
    const plan = el.querySelector('[aria-label="Leave plan mode"]');
    expect(plan).not.toBeNull();
    expect(plan?.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('[aria-label="Set a goal"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  test('Plan is hidden while Goal is on, because omp refuses both at once', () => {
    const el = paint({ planAvailable: false, goal: true });
    expect(el.querySelector('[aria-label="Enter plan mode"]')).toBeNull();
    expect(el.querySelector('[aria-label="Leave plan mode"]')).toBeNull();
    expect(el.querySelector('[aria-label="Manage the active goal"]')).not.toBeNull();
  });

  test('Goal is not offered where the harness cannot express one', () => {
    // A non-omp ACP agent has no `/kabmo-mode` extension and no selector that
    // can carry an objective, so the button's only outcome is a refusal — the
    // shape a control the user cannot use must not have.
    const el = paint({ goalAvailable: false });

    expect(el.querySelector('[aria-label="Set a goal"]')).toBeNull();
    expect(el.querySelector('[aria-label="Manage the active goal"]')).toBeNull();
    // Plan stays on offer: an agent that publishes a `plan` mode can honour it.
    expect(el.querySelector('[aria-label="Enter plan mode"]')).not.toBeNull();
  });

  test('the goal button carries the record in its title', () => {
    // The budget figure itself moved to the goal strip above the composer; the
    // button stays the mode control and the way into the modal.
    const el = paint({ goal: true, goalRecord });
    const button = el.querySelector('[aria-label="Manage the active goal"]');
    expect(button?.getAttribute('title')).toContain('50,000');
    expect(el.textContent).not.toContain('left');
  });
});

describe('an armed goal', () => {
  test('reads as set but not running, and says what starts it', () => {
    const el = paint({ goalArm: { kind: 'create', objective: 'Ship the importer' } });
    const button = el.querySelector('[aria-label="Edit the armed goal"]') as HTMLButtonElement | null;

    expect(button).not.toBeNull();
    // Pressed, because it IS set — but the label and the title both name the
    // waiting state, so "on" never claims work that has not started.
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(button?.title).toContain('starts with your next message');
  });

  test('a running goal keeps the running wording', () => {
    const el = paint({ goal: true, goalRecord: goalRecord });
    expect(el.querySelector('[aria-label="Manage the active goal"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Edit the armed goal"]')).toBeNull();
  });
});
