/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The mode half of the composer: folding `CHAMBER_*` markers into goal state,
 * routing those markers to the right session, and the global approval-mode
 * preference.
 *
 * `goalMarkerPatch` is the pure fold every live mode transition goes through,
 * and its sharp edges are all one-marker-per-frame:
 *
 * - `CHAMBER_GOAL_EVALUATING` and `CHAMBER_GOAL_CONTINUATION` must NOT blank
 *   the goal record — only a `CHAMBER_GOAL_STATE` frame carries one.
 * - A continuation frame must leave `evaluating: false` standing, or a lost
 *   "decision over" frame spins the strip forever.
 * - `goalChanged` compares the record's id against the caller's mirror, so a
 *   transition to a DIFFERENT goal (or to none, on Drop) drops the previous
 *   goal's turn counter.
 * - `continuation` is only present in the patch when the payload actually
 *   carried the key: reading every token-update frame's absence as "no verdict"
 *   would erase the last verdict.
 *
 * `useModeMarkers` is pinned on the session boundary: two chats can be open at
 * once and only one owns the process that emitted a marker, so a marker tagged
 * with another session must be dropped rather than folded into this one.
 *
 * The access mode is a global preference hydrated from appSettings, and the ref
 * mirror is what the once-created send path reads.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { goalMarkerPatch, useModeMarkers } from '@/client/hooks/chat/timeline/mode-markers';
import { useChatTimelineAccessMode } from '@/client/hooks/chat/timeline/access-mode';
import { useComposerModes } from '@/client/hooks/chat/timeline/composer-modes';
import { type GoalRecord } from '@/shared/lib/omp/mode/types';
import { KABMO_MODE_SIGNAL } from '@/shared/lib/omp/mode/client-signal';
import { publishClientSignal } from '@/client/lib/signals';
import type { ParsedMarker } from '@/shared/lib/omp/mode/markers';
import { primeKabmoSettings } from '@/shared/lib/settings/client';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown so later files still have them. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

/** One parsed `CHAMBER_*` notice, as `parseModeMarker` would return it. */
function marker(name: ParsedMarker['marker'], payload: Record<string, unknown>): ParsedMarker {
  return { marker: name, payload };
}

const GOAL: GoalRecord = {
  id: 'g1',
  objective: 'Ship the importer',
  status: 'active',
  tokensUsed: 10,
  timeUsedSeconds: 5,
  createdAt: 0,
  updatedAt: 0,
};

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const originalFetch = Bun.fetch;
const settingsPosts: string[] = [];
let container: HTMLElement | undefined;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  target.fetch = (async (input: unknown, init?: { body?: string }) => {
    if (String(input) === '/api/settings') settingsPosts.push(String(init?.body ?? ''));
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  settingsPosts.length = 0;
  primeKabmoSettings({});
});

async function drain(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await act(async () => {});
}

describe('goalMarkerPatch', () => {
  test('a non-goal marker folds to nothing', () => {
    expect(goalMarkerPatch(marker('CHAMBER_PLAN_STATE:', { plan: true }), null)).toBeNull();
    expect(goalMarkerPatch(marker('CHAMBER_MODE_ERROR:', { reason: 'no' }), null)).toBeNull();
  });

  test('a state frame carries the record, omp enabled, and the id change', () => {
    const patch = goalMarkerPatch(marker('CHAMBER_GOAL_STATE:', { goal: GOAL, enabled: true }), null);
    expect(patch?.record).toEqual(GOAL);
    expect(patch?.enabled).toBe(true);
    expect(patch?.goalChanged).toBe(true);
  });

  test('the same goal id is not a change, so its turn counter survives', () => {
    const patch = goalMarkerPatch(marker('CHAMBER_GOAL_STATE:', { goal: GOAL, enabled: true }), 'g1');
    expect(patch?.goalChanged).toBe(false);
  });

  test('a paused goal keeps its record while enabled reads false', () => {
    const patch = goalMarkerPatch(marker('CHAMBER_GOAL_STATE:', { goal: { ...GOAL, status: 'paused' }, enabled: false }), 'g1');
    expect(patch?.record?.status).toBe('paused');
    expect(patch?.enabled).toBe(false);
    expect(patch?.goalChanged).toBe(false);
  });

  test('Drop (no record) is a change away from the current goal', () => {
    const patch = goalMarkerPatch(marker('CHAMBER_GOAL_STATE:', { goal: null, enabled: false }), 'g1');
    expect(patch?.record).toBeNull();
    expect(patch?.goalChanged).toBe(true);
  });

  test('a malformed record reads as "no goal", so the previous counter is dropped', () => {
    const patch = goalMarkerPatch(marker('CHAMBER_GOAL_STATE:', { goal: { id: 'g2' }, enabled: true }), 'g1');
    expect(patch?.record).toBeNull();
    expect(patch?.goalChanged).toBe(true);
  });

  test('a state frame without the continuation key leaves the patch key absent', () => {
    const patch = goalMarkerPatch(marker('CHAMBER_GOAL_STATE:', { goal: GOAL, enabled: true }), 'g1');
    expect(patch).not.toBeNull();
    expect('continuation' in (patch as object)).toBe(false);
  });

  test('a state frame carrying a continuation reports it', () => {
    const patch = goalMarkerPatch(
      marker('CHAMBER_GOAL_STATE:', { goal: GOAL, enabled: true, continuation: { turn: 3, maxTurns: 5, stopped: 'budget' } }),
      'g1',
    );
    expect(patch?.continuation).toEqual({ turn: 3, maxTurns: 5, stopped: 'budget' });
  });

  test('a continuation frame never blanks the record and clears evaluating', () => {
    const patch = goalMarkerPatch(marker('CHAMBER_GOAL_CONTINUATION:', { turn: 2, maxTurns: 5 }), 'g1');
    expect(patch?.record).toBeNull();
    expect(patch?.evaluating).toBe(false);
    expect(patch?.continuation).toEqual({ turn: 2, maxTurns: 5 });
    expect(patch?.goalChanged).toBe(false);
  });

  test('a turn-0 continuation is a version skew and reports none', () => {
    const patch = goalMarkerPatch(marker('CHAMBER_GOAL_CONTINUATION:', { turn: 0, maxTurns: 5 }), 'g1');
    expect(patch?.continuation).toBeNull();
  });

  test('an evaluating frame carries only the evaluating flag', () => {
    const on = goalMarkerPatch(marker('CHAMBER_GOAL_EVALUATING:', { evaluating: true }), 'g1');
    expect(on?.evaluating).toBe(true);
    expect(on?.record).toBeNull();
    expect(on?.continuation).toBeUndefined();
    const off = goalMarkerPatch(marker('CHAMBER_GOAL_EVALUATING:', {}), 'g1');
    expect(off?.evaluating).toBe(false);
  });
});

describe('useModeMarkers', () => {
  const seen: ParsedMarker[] = [];

  beforeEach(() => { seen.length = 0; });

  function MarkerProbe({ sessionId }: { sessionId: string | null }) {
    useModeMarkers(sessionId, (m) => { seen.push(m); });
    return null;
  }

  function dispatch(detail: { sessionId?: string; marker?: unknown }): void {
    publishClientSignal(KABMO_MODE_SIGNAL, detail);
  }

  async function mount(sessionId: string | null): Promise<void> {
    container ??= document.body.appendChild(document.createElement('div'));
    await act(async () => { render(h(MarkerProbe, { sessionId }), container as HTMLElement); });
    await drain();
  }

  test('a marker for the subscribed session is delivered', async () => {
    await mount('s1');
    const m = marker('CHAMBER_GOAL_STATE:', { goal: GOAL, enabled: true });
    await act(async () => { dispatch({ sessionId: 's1', marker: m }); });
    expect(seen).toEqual([m]);
  });

  test('a marker owned by another session is dropped', async () => {
    await mount('s1');
    await act(async () => { dispatch({ sessionId: 's2', marker: marker('CHAMBER_GOAL_STATE:', { enabled: true }) }); });
    expect(seen).toHaveLength(0);
  });

  test('an untagged marker reaches the subscriber', async () => {
    await mount('s1');
    await act(async () => { dispatch({ marker: marker('CHAMBER_MODE_ERROR:', { reason: 'x' }) }); });
    expect(seen).toHaveLength(1);
  });

  test('a detail with no marker is ignored', async () => {
    await mount('s1');
    await act(async () => { dispatch({ sessionId: 's1' }); });
    expect(seen).toHaveLength(0);
  });

  test('unmounting stops delivery', async () => {
    await mount('s1');
    await act(async () => { render(null, container as HTMLElement); });
    await act(async () => { dispatch({ sessionId: 's1', marker: marker('CHAMBER_MODE_ERROR:', { reason: 'x' }) }); });
    expect(seen).toHaveLength(0);
  });
});

describe('useChatTimelineAccessMode', () => {
  function AccessProbe({ appSettings }: { appSettings: Record<string, any> }) {
    const { accessMode, accessModeRef, setAccessMode } = useChatTimelineAccessMode(appSettings);
    return h(
      'div',
      null,
      h('span', { id: 'mode' }, accessMode),
      h('span', { id: 'ref' }, accessModeRef.current),
      h('button', { id: 'yolo', onClick: () => setAccessMode('yolo') }, 'yolo'),
    );
  }

  function paint(appSettings: Record<string, any>): HTMLElement {
    container ??= document.body.appendChild(document.createElement('div'));
    render(h(AccessProbe, { appSettings }), container as HTMLElement);
    return container;
  }

  test('hydrates the persisted approval mode', () => {
    const el = paint({ omp_access_mode: 'write' });
    expect(el.querySelector('#mode')?.textContent).toBe('write');
    expect(el.querySelector('#ref')?.textContent).toBe('write');
  });

  test('an unknown persisted value falls back to always-ask', () => {
    expect(paint({ omp_access_mode: 'sudo' }).querySelector('#mode')?.textContent).toBe('always-ask');
  });

  test('a missing key falls back to always-ask', () => {
    expect(paint({}).querySelector('#mode')?.textContent).toBe('always-ask');
  });

  test('a pick updates the rendered value and the ref the send path reads', async () => {
    const el = paint({});
    await act(async () => { (el.querySelector('#yolo') as HTMLButtonElement).click(); });
    expect(el.querySelector('#mode')?.textContent).toBe('yolo');
    expect(el.querySelector('#ref')?.textContent).toBe('yolo');
  });

  test('a pick is persisted under the spawn-time setting key', async () => {
    const el = paint({ omp_access_mode: 'always-ask' });
    await act(async () => { (el.querySelector('#yolo') as HTMLButtonElement).click(); });
    await drain();
    expect(settingsPosts).toContain(JSON.stringify({ omp_access_mode: 'yolo' }));
  });
});

describe('useComposerModes', () => {
  function ComposerProbe({ sessionId }: { sessionId: string | null }) {
    const { modes, planReview } = useComposerModes(sessionId);
    return h(
      'div',
      null,
      h('span', { id: 'plan' }, String(modes.plan)),
      h('span', { id: 'available' }, String(modes.planAvailable)),
      h('span', { id: 'proposal' }, planReview.proposal ? planReview.proposal.title : 'none'),
    );
  }

  test('both halves are wired and a plan proposal reaches the review surface', async () => {
    container ??= document.body.appendChild(document.createElement('div'));
    await act(async () => { render(h(ComposerProbe, { sessionId: 's1' }), container as HTMLElement); });
    await drain();
    const el = container;
    expect(el.querySelector('#plan')?.textContent).toBe('false');
    expect(el.querySelector('#available')?.textContent).toBe('true');
    expect(el.querySelector('#proposal')?.textContent).toBe('none');

    await act(async () => {
      publishClientSignal(KABMO_MODE_SIGNAL, {
        sessionId: 's1',
        marker: { marker: 'CHAMBER_PLAN_PROPOSAL:', payload: { title: 'The plan', planFilePath: '/p.md' } },
      });
    });
    expect(el.querySelector('#proposal')?.textContent).toBe('The plan');
  });
});
