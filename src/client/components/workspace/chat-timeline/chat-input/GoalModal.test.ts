/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Goal modal's submit contract: the form closes on success and STAYS on a
 * refusal.
 *
 * The previous version called `onSubmit` then `onClose` unconditionally, so a
 * refused command closed the dialog and threw away the objective the user had
 * just written — the refusal read as a dead button and the text was gone.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { GoalModal } from '@/client/components/workspace/chat-timeline/chat-input/GoalModal';
import type { GoalActionResult } from '@/client/hooks/chat/timeline/goal-command';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined as unknown as HTMLElement;
});

afterAll(() => {
  restoreDomGlobals();
});

interface Probe {
  closes: number;
  submitted: unknown[];
  el: HTMLElement;
}

/**
 * The dialog's own subtree. It is PORTALLED to `<body>`, so it is not a child of
 * the mount container — that separation is the fix for the composer's
 * `contain: layout` sizing `position: fixed` (see the component).
 */
function dialog(): HTMLElement {
  const node = document.body.querySelector('.glass-overlay') as HTMLElement | null;
  if (!node) throw new Error('the goal dialog did not portal into <body>');
  return node;
}

/** The fixed scrim the portal mounts: the containing block question is about
 *  THIS element, since it is the one carrying `fixed inset-0`. */
function scrim(): HTMLElement {
  const node = dialog().parentElement as HTMLElement | null;
  if (!node) throw new Error('the dialog card has no scrim');
  return node;
}

/** Mount the create form with `onSubmit` answering `answer`. */
async function mountCreate(answer: GoalActionResult): Promise<Probe> {
  const probe: Probe = { closes: 0, submitted: [], el: null as unknown as HTMLElement };
  container = document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(
      h(GoalModal, {
        open: true,
        goal: false,
        goalRecord: null,
        pending: false,
        onClose: () => { probe.closes += 1; },
        onSubmit: async (action) => {
          probe.submitted.push(action);
          return answer;
        },
      }),
      container,
    );
  });
  probe.el = container;
  return probe;
}

/** Type an objective into the create form's textarea. */
async function typeObjective(text: string): Promise<void> {
  const textarea = dialog().querySelector('textarea') as HTMLTextAreaElement;
  await act(async () => {
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function clickStart(): void {
  const button = [...dialog().querySelectorAll('button')].find((node) => node.textContent?.includes('Start goal'));
  if (!button) throw new Error('no Start goal button');
  button.click();
}

describe('GoalModal submit', () => {
  test('closes only after the command succeeded', async () => {
    const probe = await mountCreate({ ok: true, sessionId: 'omp-1' });
    await typeObjective('Ship the importer');
    await act(async () => { clickStart(); });
    for (let i = 0; i < 5; i += 1) await act(async () => {});

    expect(probe.submitted).toEqual([{ kind: 'create', objective: 'Ship the importer' }]);
    expect(probe.closes).toBe(1);
  });

  test('a refusal keeps the form, the objective and the reason on screen', async () => {
    const probe = await mountCreate({ ok: false, error: 'Cannot start a goal while plan mode is active.' });
    await typeObjective('Ship the importer');
    await act(async () => { clickStart(); });
    for (let i = 0; i < 5; i += 1) await act(async () => {});

    expect(probe.closes).toBe(0);
    // The text is still there, so a retry does not mean retyping the objective.
    expect((dialog().querySelector('textarea') as HTMLTextAreaElement).value).toBe('Ship the importer');
    expect(dialog().textContent).toContain('Cannot start a goal while plan mode is active.');
  });
});

describe('GoalModal on an armed submit', () => {
  test('closes on armed:true, which is a success without a running goal', async () => {
    const probe = await mountCreate({ ok: true, armed: true });
    await typeObjective('Ship the importer');
    await act(async () => { clickStart(); });
    for (let i = 0; i < 5; i += 1) await act(async () => {});

    // Arming is a successful submit: the form must not linger over a goal the
    // strip now owns.
    expect(probe.closes).toBe(1);
  });
});

describe('GoalModal placement', () => {
  test('mounts OUTSIDE the composer card, in <body>', async () => {
    // The composer is a `@container` (`container-type: inline-size` ⇒
    // `contain: layout`), which becomes the containing block for
    // `position: fixed` — so a dialog rendered inside it centred on the CARD,
    // not the viewport ("muncul di depan composer"). A portal is the fix, and
    // this pins it: the dialog must not be a descendant of the mount point.
    await mountCreate({ ok: true });

    const node = scrim();
    const mountPoint = container as HTMLElement;
    expect(mountPoint.contains(node)).toBe(false);
    expect(node.parentElement).toBe(document.body);
    // The scrim is what `inset-0` must resolve against the viewport.
    expect(node.className).toContain('fixed');
    expect(node.className).toContain('inset-0');
  });

  test('does not mount at all while closed', async () => {
    container = document.body.appendChild(document.createElement('div'));
    await act(async () => {
      render(
        h(GoalModal, {
          open: false,
          goal: false,
          goalRecord: null,
          pending: false,
          onClose: () => {},
          onSubmit: async () => ({ ok: true }),
        }),
        container,
      );
    });
    expect(document.body.querySelector('.glass-overlay')).toBeNull();
  });
});
