/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The goal strip above the composer.
 *
 * What these pin is what the row claims about the child: the turn it names must
 * come from the loop's own frame (`GoalContinuation`), the only action it
 * offers must be the one that applies to the state on screen, and a goal that
 * has stopped at its ceiling must offer a control that actually resumes it —
 * the child's counter starts over on Resume, so "stopped" is a state the user
 * can leave.
 *
 * Rendered with `h()` (no JSX) against happy-dom, the same way
 * `ModeToggles.test.ts` does.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { GoalBanner, type GoalBannerProps } from '@/client/components/workspace/chat-timeline/chat-input/GoalBanner';
import type { GoalAction } from '@/client/hooks/chat/timeline/modes';
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

const record: GoalRecord = {
  id: 'g1',
  objective: 'Migrate the importer to streaming\n\n## Success criteria\n- tests pass',
  status: 'active',
  tokenBudget: 200000,
  tokensUsed: 50000,
  timeUsedSeconds: 3700,
  createdAt: 0,
  updatedAt: 0,
};

/** The row's action button, by its accessible name. happy-dom nodes carry
 *  `.click()`; `querySelector` types its result as `Element`, which does not. */
function actionButton(el: HTMLElement, label: string): HTMLButtonElement {
  const node = el.querySelector(`[aria-label="${label}"]`);
  if (!node) throw new Error(`no button labelled ${label}`);
  return node as HTMLButtonElement;
}

function paint(overrides: Partial<GoalBannerProps> = {}, actions: GoalAction[] = []): HTMLElement {
  const props: GoalBannerProps = {
    record,
    running: false,
    continuation: null,
    evaluating: false,
    pending: false,
    onAction: (action) => actions.push(action),
    onOpenDetails: () => {},
    ...overrides,
  };
  if (container) render(null, container);
  render(h(GoalBanner, props), container);
  return container;
}

describe('GoalBanner', () => {
  test('names the turn the loop opened, and pauses the goal', () => {
    const actions: GoalAction[] = [];
    const el = paint({ running: true, continuation: { turn: 3, maxTurns: 25 } }, actions);

    expect(el.textContent).toContain('turn 3/25');
    // Both figures, compacted: the wide row is where the record's numbers live
    // now that the toolbar button carries none.
    expect(el.textContent).toContain('50k / 200k');
    expect(el.textContent).toContain('1h 1m');

    actionButton(el, 'Pause the goal').click();
    expect(actions).toEqual([{ kind: 'pause' }]);
  });

  test('the objective is cut to one line, with the whole text as its tooltip', () => {
    const el = paint();
    expect(el.textContent).toContain('Migrate the importer to streaming');
    expect(el.textContent).not.toContain('Success criteria');
    expect(el.querySelector('[title*="Success criteria"]')).not.toBeNull();
  });

  test('a paused goal offers Resume, not Pause', () => {
    const actions: GoalAction[] = [];
    const el = paint({ record: { ...record, status: 'paused' }, continuation: { turn: 4, maxTurns: 25 } }, actions);

    expect(el.querySelector('[aria-label="Pause the goal"]')).toBeNull();
    actionButton(el, 'Resume the goal').click();
    expect(actions).toEqual([{ kind: 'resume' }]);
  });

  test('a goal stopped at the turn ceiling is resumable, and says why', () => {
    // The child resets its counter on Resume, so this state is not terminal —
    // which is exactly what the row must not claim by disabling the button.
    const actions: GoalAction[] = [];
    const el = paint({ continuation: { turn: 25, maxTurns: 25, stopped: 'max-turns' } }, actions);

    expect(el.textContent).toContain('stopped at 25 turns');
    expect(el.textContent).not.toContain('turn 25/25');
    actionButton(el, 'Resume the goal').click();
    expect(actions).toEqual([{ kind: 'resume' }]);
  });

  test('a pending mode command disables the row rather than hiding it', () => {
    const el = paint({ pending: true });
    expect(actionButton(el, 'Pause the goal').disabled).toBe(true);
  });

  test('a finished goal leaves no strip behind', () => {
    for (const status of ['complete', 'dropped'] as const) {
      const el = paint({ record: { ...record, status } });
      expect(el.querySelector('[data-goal-banner]')).toBeNull();
      expect(el.textContent).toBe('');
    }
  });

  test('the loop deciding spins the row and says so', () => {
    // `evaluating` arrives from the child between turns; there is no streaming
    // turn at that moment, so nothing else in the composer reports activity.
    const el = paint({ evaluating: true });
    expect(el.textContent).toContain('evaluating');
    expect(el.querySelector('.animate-spin')).not.toBeNull();
    expect(actionButton(el, 'Pause the goal')).not.toBeNull();
  });

  test('a stop for budget offers the budget, not a loop restart', () => {
    // Resume would restart the count and the next end would stand down again
    // (`tokensUsed >= budget`), so the fix is the number the user set.
    let opened = 0;
    const el = paint({ continuation: { turn: 4, maxTurns: 25, stopped: 'budget' }, onOpenDetails: () => (opened += 1) });
    expect(el.textContent).toContain('budget reached');
    expect(el.querySelector('[aria-label="Resume the goal"]')).toBeNull();
    actionButton(el, 'Raise the goal budget').click();
    expect(opened).toBe(1);
  });

  test("the auditor's complete ends the row's loop actions", () => {
    const el = paint({ continuation: { turn: 6, maxTurns: 25, stopped: 'complete' } });
    expect(el.textContent).toContain('auditor: complete');
    expect(el.textContent).toContain('done');
    // Nothing to resume: the goal is finished, and only Drop (in the modal)
    // still makes sense.
    expect(el.querySelector('[aria-label="Resume the goal"]')).toBeNull();
    expect(el.querySelector('[aria-label="Pause the goal"]')).toBeNull();
    actionButton(el, 'Goal details');
  });

  test('a blocked goal asks for the user and can be resumed', () => {
    const actions: GoalAction[] = [];
    const el = paint({ continuation: { turn: 3, maxTurns: 25, stopped: 'blocked' } }, actions);
    expect(el.textContent).toContain('needs you');
    actionButton(el, 'Resume the goal').click();
    expect(actions).toEqual([{ kind: 'resume' }]);
  });
});
