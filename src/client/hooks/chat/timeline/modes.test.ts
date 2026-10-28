/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's mode hydration, and the rule that a session never wears
 * another session's modes.
 *
 * The mode record is read per session (`GET /api/sessions/:id/modes`), and the
 * read FAILS for a session with no file — a pending `new-…` chat, a deleted
 * one: the route answers 404. Keeping the previous answer there meant the goal
 * strip rendered the last chat's objective over a chat that has no goal at all,
 * and the Goal button stayed pressed for a mode this session is not in.
 *
 * Rendered with `h()` (no JSX) against happy-dom, the same way
 * `ModeToggles.test.ts` and `GoalBanner.test.ts` do.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useChatTimelineModes } from '@/client/hooks/chat/timeline/modes';
import { GoalBanner } from '@/client/components/workspace/chat-timeline/chat-input/GoalBanner';
import { KABMO_MODE_SIGNAL } from '@/shared/lib/omp/mode/client-signal';
import { publishClientSignal } from '@/client/lib/signals';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown — deleting them would strip natives (Event/CustomEvent) every later file needs. */const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
/** The runner's own fetch — this file replaces it for the whole process. */
/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

const WITH_GOAL = 'session-with-goal';
/** A live goal whose loop has NOT reported a verdict — the state in which the
 *  evaluating frame is the only activity to show. */
const LIVE_GOAL = 'session-live-goal';
const WITHOUT_FILE = 'new-1790756769131';

let container: HTMLElement | undefined;

/** The composer's own gate: the strip exists while the chat is in goal mode. */
function Probe({ sessionId }: { sessionId: string }) {
  const modes = useChatTimelineModes(sessionId);
  return h(
    'div',
    { id: 'probe' },
    h('button', { id: 'resume', onClick: () => modes.onGoalAction({ kind: 'resume' }) }, 'resume'),
    h('button', { id: 'pause', onClick: () => modes.onGoalAction({ kind: 'pause' }) }, 'pause'),
    // The Plan toggle, and the selection its spawn would carry. Rendered as
    // text because that is what the assertions read: the composer paints the
    // refusal strip, and the send path reads the ref.
    h(
      'button',
      { id: 'plan', onClick: () => modes.onTogglePlan(!modes.plan), 'data-pressed': String(modes.plan) },
      modes.plan ? 'on' : 'off',
    ),
    h('span', { id: 'spawn' }, JSON.stringify(modes.spawnSelectionRef.current)),
    h('span', { id: 'error' }, modes.error ?? ''),
    modes.goalOpen && modes.goalRecord
      ? h(GoalBanner, {
          record: modes.goalRecord,
          running: false,
          continuation: modes.goalContinuation,
          evaluating: modes.goalEvaluating,
          pending: modes.pending,
          onAction: modes.onGoalAction,
          onOpenDetails: () => {},
        })
      : null,
  );
}

/** Every request the hook issued, so a test can assert what was NOT sent. */
const requests: Array<{ url: string; method: string }> = [];
/** When set, a POST to the agent route answers this instead of success. */
let postFailure: { status: number; error: string } | null = null;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  target.fetch = async (input: unknown, init?: { method?: string }) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? 'GET' });
    if (init?.method === 'POST') {
      if (postFailure) {
        return new Response(JSON.stringify({ error: postFailure.error }), {
          status: postFailure.status,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes(`/${WITH_GOAL}/modes`) || url.includes(`/${LIVE_GOAL}/modes`)) {
      const live = url.includes(`/${LIVE_GOAL}/modes`);
      return new Response(
        JSON.stringify({
          sessionId: live ? LIVE_GOAL : WITH_GOAL,
          modes: {
            plan: false,
            goal: true,
            goalRecord: {
              id: 'g1',
              objective: 'Ship the importer',
              status: 'active',
              tokensUsed: 10,
              timeUsedSeconds: 5,
              createdAt: 0,
              updatedAt: 0,
            },
            // The loop's verdict rides the mode record, which is what lets a
            // reload show "stopped at 5 turns" instead of an active-looking goal.
            ...(live ? {} : { goalContinuation: { turn: 5, maxTurns: 5, stopped: 'max-turns' } }),
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    // What the route answers for a session with no file.
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  };
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
  // The runner's own fetch comes back: `delete` removed the global outright,
  // so every suite after this one had no `fetch` at all.
  target.fetch = nativeFetch;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  requests.length = 0;
  postFailure = null;
});

/** Mounts `sessionId`, then drains the hydrate promise and its re-render. */
async function mount(sessionId: string) {
  container ??= document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(h(Probe, { sessionId }), container as HTMLElement);
  });
  for (let i = 0; i < 10; i += 1) await act(async () => {});
  return container;
}

describe('useChatTimelineModes hydration', () => {
  test('a session with a live goal renders the strip', async () => {
    const el = await mount(WITH_GOAL);
    expect(el.querySelector('[data-goal-banner]')).not.toBeNull();
    expect(el.textContent).toContain('Ship the importer');
  });

  test('a session whose record cannot be read does not inherit the previous one', async () => {
    await mount(WITH_GOAL);
    const el = await mount(WITHOUT_FILE);
    expect(el.querySelector('[data-goal-banner]')).toBeNull();
    expect(el.textContent).not.toContain('Ship the importer');
  });

  test('an accepted Resume drops the last "stopped" verdict', async () => {
    const el = await mount(WITH_GOAL);
    await act(async () => {
      publishClientSignal(KABMO_MODE_SIGNAL, {
        sessionId: WITH_GOAL,
        marker: {
          marker: 'CHAMBER_GOAL_CONTINUATION:',
          payload: { turn: 25, maxTurns: 25, stopped: 'max-turns' },
        },
      });
    });
    expect(el.textContent).toContain('stopped at 25 turns');

    // omp's own resume opens no turn, so no frame would correct a stale verdict
    // — the loop's count starts over in the child and only its NEXT turn reports
    // a number. Leaving the row saying "stopped" would describe a state the
    // operator just left.
    await act(async () => {
      (el.querySelector('#resume') as HTMLButtonElement).click();
    });
    for (let i = 0; i < 10; i += 1) await act(async () => {});
    expect(el.textContent).not.toContain('stopped at');
  });

  test('an accepted Pause shows the paused row without waiting for a marker', async () => {
    const el = await mount(WITH_GOAL);
    await act(async () => {
      (el.querySelector('#pause') as HTMLButtonElement).click();
    });
    for (let i = 0; i < 10; i += 1) await act(async () => {});
    // No marker is dispatched in this test: the strip must not depend on the
    // event stream to reflect the press it just made.
    expect(el.querySelector('[data-goal-banner]')?.getAttribute('data-goal-banner')).toBe('paused');
    expect(el.textContent).toContain('Resume');
  });

  test('the loop deciding is visible: the evaluating frame spins the row', async () => {
    const el = await mount(LIVE_GOAL);
    await act(async () => {
      publishClientSignal(KABMO_MODE_SIGNAL, {
        sessionId: LIVE_GOAL,
        marker: { marker: 'CHAMBER_GOAL_EVALUATING:', payload: { evaluating: true } },
      });
    });
    expect(el.textContent).toContain('evaluating');
    expect(el.querySelector('.animate-spin')).not.toBeNull();

    await act(async () => {
      publishClientSignal(KABMO_MODE_SIGNAL, {
        sessionId: LIVE_GOAL,
        marker: { marker: 'CHAMBER_GOAL_EVALUATING:', payload: { evaluating: false } },
      });
    });
    expect(el.textContent).not.toContain('evaluating');
  });

  test('a verdict the child persisted survives the reload that hydrates it', async () => {
    const el = await mount(WITH_GOAL);
    expect(el.textContent).toContain('stopped at 5 turns');
    expect(el.querySelector('[aria-label="Resume the goal"]')).not.toBeNull();
  });
});

describe('the Plan toggle', () => {
  test('a pending chat keeps the pick locally and never POSTs to a session that does not exist', async () => {
    const el = await mount(WITHOUT_FILE);
    requests.length = 0;
    await act(async () => {
      (el.querySelector('#plan') as HTMLButtonElement).click();
    });
    for (let i = 0; i < 5; i += 1) await act(async () => {});

    // The button is on, and the SEND path has the selection it must hand the
    // spawn. The server has heard nothing: `/api/agent/new-…` answers 404, and
    // a POST whose only outcome is a failure would also leave the toggle
    // reading a mode nothing applied (the bug this pins).
    expect(el.querySelector('#plan')?.getAttribute('data-pressed')).toBe('true');
    expect(el.querySelector('#spawn')?.textContent).toBe('{"plan":true,"goal":false}');
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  test('a refusal from the child rolls the optimistic flip back and reports why', async () => {
    const el = await mount(WITH_GOAL);
    // The child refuses `plan on` while a goal is live. The route answers 200 —
    // the command was DELIVERED, and the refusal travels as a marker — so the
    // rollback has to come from the marker's SCOPE, not from the status.
    await act(async () => {
      (el.querySelector('#plan') as HTMLButtonElement).click();
    });
    for (let i = 0; i < 5; i += 1) await act(async () => {});
    expect(el.querySelector('#plan')?.getAttribute('data-pressed')).toBe('true');

    await act(async () => {
      publishClientSignal(KABMO_MODE_SIGNAL, {
        sessionId: WITH_GOAL,
        marker: {
          marker: 'CHAMBER_MODE_ERROR:',
          payload: { scope: 'plan', reason: 'Cannot enter plan mode while a goal is active.' },
        },
      });
    });
    expect(el.querySelector('#error')?.textContent).toContain('Cannot enter plan mode');
    expect(el.querySelector('#plan')?.getAttribute('data-pressed')).toBe('false');
  });

  test('a GOAL refusal does not disturb the Plan toggle', async () => {
    const el = await mount(WITH_GOAL);
    await act(async () => {
      (el.querySelector('#plan') as HTMLButtonElement).click();
    });
    for (let i = 0; i < 5; i += 1) await act(async () => {});
    expect(el.querySelector('#plan')?.getAttribute('data-pressed')).toBe('true');

    // A goal-side refusal reports its own scope; rolling Plan back for it would
    // turn a working mode off because an unrelated command failed.
    await act(async () => {
      publishClientSignal(KABMO_MODE_SIGNAL, {
        sessionId: WITH_GOAL,
        marker: { marker: 'CHAMBER_MODE_ERROR:', payload: { scope: 'goal', reason: 'an objective is required' } },
      });
    });
    expect(el.querySelector('#plan')?.getAttribute('data-pressed')).toBe('true');
  });

  test('a rejected request rolls the flip back too', async () => {
    const el = await mount(WITH_GOAL);
    postFailure = { status: 400, error: 'invalid_mode_request' };
    await act(async () => {
      (el.querySelector('#plan') as HTMLButtonElement).click();
    });
    for (let i = 0; i < 10; i += 1) await act(async () => {});
    expect(el.querySelector('#plan')?.getAttribute('data-pressed')).toBe('false');
    expect(el.querySelector('#error')?.textContent).toBe('invalid_mode_request');
  });
});
