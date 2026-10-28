/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Rename with AI" reports its outcome, and the wait is visible while it runs.
 *
 * Two defects are pinned here. The wait used to be silent: the request is a
 * model call of a few seconds, the menu that started it closes immediately, and
 * nothing on screen said the click had landed — a user clicked again, and the
 * second generation re-derived the title from the transcript the first was
 * naming. And the outcome used to be reported only on failure, so a successful
 * rename was indistinguishable from one that never arrived: the title changed
 * under a spinner that had already vanished.
 *
 * The mark is asserted through the store the rows and the navbar read, because
 * that is the contract between them — a per-caller flag would leave the row
 * spinning while the navbar stayed still.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useSessionActions, type SessionActions } from '@/client/hooks/workspace/session-actions';
import { isSessionRenaming, setSessionRenaming } from '@/client/hooks/workspace/renaming-sessions';
import type { SessionItemData } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown — deleting them would strip natives (Event/CustomEvent) every later file needs. */
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  globalThis.fetch = originalFetch;
  setSessionRenaming('s1', false);
});

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const originalFetch = Bun.fetch;

const session: SessionItemData = { id: 's1', folder_id: 1, title: 'old name' };

interface Reported {
  message: string;
  tone: 'success' | 'error' | undefined;
}

interface Harness {
  actions: SessionActions;
  reports: Reported[];
  requests: string[];
}

/** One deferred answer per request, so the in-flight state can be observed. */
function makeHarness(options: { fail?: boolean } = {}): Harness & { resolveNext: (body: unknown, status?: number) => void } {
  const reports: Reported[] = [];
  const requests: string[] = [];
  const pending: Array<(response: Response) => void> = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (options.fail) throw new Error('offline');
    return new Promise<Response>((resolve) => pending.push(resolve));
  }) as typeof fetch;

  const seen: { current: SessionActions | null } = { current: null };
  function Probe() {
    seen.current = useSessionActions(() => {}, (message, tone) => reports.push({ message, tone }));
    return null;
  }

  container = document.body.appendChild(document.createElement('div'));
  act(() => {
    render(h(Probe, {}), container);
  });

  return {
    get actions() {
      return seen.current!;
    },
    reports,
    requests,
    resolveNext: (body, status = 200) => {
      pending.shift()?.(new Response(JSON.stringify(body), { status }));
    },
  };
}

describe('handleRenameWithAi', () => {
  test('marks the session while the request is in flight and clears it after', async () => {
    const harness = makeHarness();
    expect(isSessionRenaming('s1')).toBe(false);

    const run = harness.actions.handleRenameWithAi(session);
    // The mark is set synchronously, before any await — a row rendered in the
    // same tick as the click must already be spinning.
    expect(isSessionRenaming('s1')).toBe(true);

    harness.resolveNext({ success: true, name: 'a generated name' });
    await run;

    expect(isSessionRenaming('s1')).toBe(false);
    expect(harness.requests).toEqual(['/api/sessions/s1/rename-with-ai']);
  });

  test('reports the produced title as a success, after the spinner is cleared', async () => {
    const harness = makeHarness();
    const run = harness.actions.handleRenameWithAi(session);
    harness.resolveNext({ success: true, name: 'PostgreSQL pool in Rust' });
    await run;

    expect(harness.reports).toEqual([{ message: 'Renamed to "PostgreSQL pool in Rust".', tone: 'success' }]);
    expect(isSessionRenaming('s1')).toBe(false);
  });

  test("reports the server's own refusal reason as an error", async () => {
    const harness = makeHarness();
    const run = harness.actions.handleRenameWithAi(session);
    harness.resolveNext({ error: 'This session is working. Stop the run before renaming it.' }, 409);
    await run;

    expect(harness.reports).toEqual([
      { message: 'This session is working. Stop the run before renaming it.', tone: 'error' },
    ]);
    expect(isSessionRenaming('s1')).toBe(false);
  });

  test('a click while one is already generating issues no second request', async () => {
    const harness = makeHarness();
    const first = harness.actions.handleRenameWithAi(session);
    await harness.actions.handleRenameWithAi(session);

    expect(harness.requests).toEqual(['/api/sessions/s1/rename-with-ai']);

    harness.resolveNext({ success: true, name: 'x' });
    await first;
  });

  test('a transport failure is reported and still clears the mark', async () => {
    const harness = makeHarness({ fail: true });
    await harness.actions.handleRenameWithAi(session);

    expect(harness.reports).toEqual([{ message: 'offline', tone: 'error' }]);
    expect(isSessionRenaming('s1')).toBe(false);
  });
});
