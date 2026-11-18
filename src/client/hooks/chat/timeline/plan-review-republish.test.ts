/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The plan-review republish probe is a PLAN-MODE question.
 *
 * A proposal can only be parked by the plan-mode approval path, so a chat that
 * is not in plan mode has nothing to re-send. The probe used to fire on every
 * mount, which made a normal chat dispatch a `/kabmo-mode` prompt every time it
 * was opened — and that prompt re-armed the run (a `stream` row plus
 * `promptRunning` for the 10 s watchdog) over a session that had already
 * finished. Both directions are pinned here: no plan mode, no request; plan
 * mode, one GET then one POST.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { usePlanReview as UsePlanReview, PlanReviewState } from '@/client/hooks/chat/timeline/plan-review';

let usePlanReview: typeof UsePlanReview;
let h: typeof PreactH;
let render: typeof PreactRender;
let act: typeof PreactAct;

const realFetch = globalThis.fetch;

beforeAll(async () => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  // Static imports cannot work here: Preact binds its environment at module
  // evaluation time, so these must load after the DOM globals are installed.
  ({ usePlanReview } = await import('@/client/hooks/chat/timeline/plan-review'));
  ({ h, render } = await import('preact'));
  ({ act } = await import('preact/test-utils'));
});

afterAll(() => {
  restoreDomGlobals();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

interface ProbeProps {
  sessionId: string;
  planActive: boolean;
  holder: { current: PlanReviewState | null };
}

function Probe({ sessionId, planActive, holder }: ProbeProps) {
  holder.current = usePlanReview(sessionId, planActive);
  return null;
}

/** Mount the hook and return a re-render that changes its inputs. */
async function mountProbe(sessionId: string, planActive: boolean) {
  const holder: ProbeProps['holder'] = { current: null };
  const node = document.createElement('div');
  document.body.appendChild(node);
  const draw = async (nextPlanActive: boolean) => {
    await act(async () => {
      render(h(Probe, { sessionId, planActive: nextPlanActive, holder }), node);
    });
  };
  await draw(planActive);
  return { draw, holder };
}

/** Let the effect's fetch chain settle. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

describe('usePlanReview republish', () => {
  test('a chat outside plan mode never dispatches the probe', async () => {
    const calls: { url: string; method: string }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' });
      return new Response(JSON.stringify({ running: true }), { status: 200 });
    }) as typeof fetch;

    await mountProbe('sess-1', false);
    await flush();
    expect(calls).toEqual([]);
  });

  test('plan mode probes once: a GET, then the republish POST', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body as string | undefined });
      return new Response(JSON.stringify({ running: true }), { status: 200 });
    }) as typeof fetch;

    await mountProbe('sess-1', true);
    await flush();
    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST']);
    expect(calls[1]?.url).toContain('/api/agent/sess-1');
    expect(calls[1]?.body).toContain('"kabmo_mode"');
  });

  test('entering plan mode after mount fires the probe', async () => {
    const calls: { method: string }[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET' });
      return new Response(JSON.stringify({ running: true }), { status: 200 });
    }) as typeof fetch;

    const probe = await mountProbe('sess-1', false);
    await flush();
    expect(calls).toEqual([]);

    await probe.draw(true);
    await flush();
    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST']);
  });
});
