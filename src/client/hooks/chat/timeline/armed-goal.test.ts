/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Setting a goal ARMS it; it does not start it.
 *
 * The rule the operator asked for, and the reason it is the right one: a goal
 * costs tokens and needs a turn to act on, so the turn has to be the operator's
 * own message. Creating it at that fence is also what keeps the transcript
 * honest — a self-opening goal turn was measured to produce `user ×0`, i.e. an
 * assistant answering a question nobody can see.
 *
 * `chat-command.test.ts` owns the other half (the `/goal` command against a
 * live child); this file owns the armed state and its surfaces.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useChatTimelineModes } from '@/client/hooks/chat/timeline/modes';
import type { ArmedGoal } from '@/shared/lib/omp/mode/actions';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
const nativeFetch = Bun.fetch;

/** A session whose transcript exists and has no goal (the modes read answers
 *  the empty selection). */
const LIVE = 'session-live-empty';
const PENDING = 'new-1790756769131';

let container: HTMLElement | undefined;
const requests: Array<{ url: string; method: string }> = [];

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
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes(`/${LIVE}/modes`)) {
      return new Response(JSON.stringify({ sessionId: LIVE, modes: { plan: false, goal: false, goalRecord: null } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
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
  target.fetch = nativeFetch;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
  requests.length = 0;
});

interface Probe {
  el: HTMLElement;
  lastResult: () => unknown;
  armed: () => ArmedGoal | null;
}

/** Mount the mode hook and expose the two things a case asserts on. */
async function mount(sessionId: string): Promise<Probe> {
  let lastResult: unknown = null;
  let armed: ArmedGoal | null = null;

  function ModeProbe({ id }: { id: string }) {
    const modes = useChatTimelineModes(id);
    armed = modes.goalArm;
    return h(
      'div',
      { id: 'probe' },
      h('button', {
        id: 'set-goal',
        onClick: async () => {
          lastResult = await modes.onGoalAction({ kind: 'create', objective: 'Ship the importer', tokenBudget: 50_000 });
        },
      }, 'set'),
      h('button', {
        id: 'interview',
        onClick: async () => {
          lastResult = await modes.onGoalAction({ kind: 'guided', rough: 'make it fast' });
        },
      }, 'interview'),
      h('button', {
        id: 'disarm',
        onClick: () => modes.disarmGoal(),
      }, 'disarm'),
      h('span', {
        id: 'armed-state',
        'data-kind': modes.goalArm?.kind ?? '',
      }, modes.goalArm ? (modes.goalArm.kind === 'guided' ? modes.goalArm.rough : modes.goalArm.objective) : ''),
    );
  }

  container ??= document.body.appendChild(document.createElement('div'));
  await act(async () => { render(h(ModeProbe, { id: sessionId }), container as HTMLElement); });
  for (let i = 0; i < 6; i += 1) await act(async () => {});
  return {
    el: container,
    lastResult: () => lastResult,
    armed: () => armed,
  };
}

async function click(el: HTMLElement, id: string): Promise<void> {
  await act(async () => { (el.querySelector(`#${id}`) as HTMLButtonElement).click(); });
  for (let i = 0; i < 6; i += 1) await act(async () => {});
}

describe('setting a goal arms it', () => {
  test('on a live session, nothing is sent until a prompt carries it', async () => {
    const probe = await mount(LIVE);
    await click(probe.el, 'set-goal');

    expect(probe.lastResult()).toEqual({ ok: true, armed: true });
    expect(probe.el.querySelector('#armed-state')?.textContent).toBe('Ship the importer');
    // The whole point: no command, no turn, no tokens.
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  });

  test('on a pending chat, arming works the same way', async () => {
    const probe = await mount(PENDING);
    await click(probe.el, 'set-goal');

    expect(probe.lastResult()).toEqual({ ok: true, armed: true });
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  });

  test('disarming clears the armed goal', async () => {
    const probe = await mount(LIVE);
    await click(probe.el, 'set-goal');
    await click(probe.el, 'disarm');

    expect(probe.el.querySelector('#armed-state')?.textContent).toBe('');
    expect(probe.armed()).toBeNull();
  });

  test('a guided interview is armed too, and waits for the message that answers it', async () => {
    const probe = await mount(PENDING);
    await click(probe.el, 'interview');

    expect(probe.lastResult()).toEqual({ ok: true, armed: true });
    // Armed, and named as an interview: there is no objective yet, so the strip
    // must not pretend one exists.
    expect(probe.armed()).toEqual({ kind: 'guided', rough: 'make it fast' });
    expect(probe.el.querySelector('#armed-state')?.getAttribute('data-kind')).toBe('guided');
    // Still nothing sent: the operator's next message is what starts it.
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  });
});
