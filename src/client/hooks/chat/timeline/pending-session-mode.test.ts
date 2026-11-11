/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The mode control on a chat that has NOT spawned yet.
 *
 * The reported defect this pins: picking an ACP harness from the model dropdown
 * changed the picker's list but left the composer's mode surface on the previous
 * agent — and a pick pressed there was POSTed to a session that does not exist,
 * so it silently did nothing. Two halves must hold:
 *
 *  - the LADDER comes from the picked harness's probe, before any session;
 *  - the PICK is recorded for the spawn (the send path reads the ref) and
 *    draws itself, never sent to `/api/agent/new-…`.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { pendingSessionMode } from '@/shared/lib/harness/session-modes';
import { useChatTimelineModes } from '@/client/hooks/chat/timeline/modes';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { ChatTimelineModes } from '@/client/hooks/chat/timeline/modes-contract';

const LADDER = [
  { value: 'ask', name: 'Ask' },
  { value: 'code', name: 'Code' },
  { value: 'architect', name: 'Architect' },
];

let container: HTMLElement;
const mounted: { value: ChatTimelineModes | null } = { value: null };
const requests: Array<{ url: string; method: string }> = [];

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  globalThis.fetch = ((input: unknown, init?: { method?: string }) => {
    requests.push({ url: String(input), method: init?.method ?? 'GET' });
    return Promise.resolve(new Response('{}', { status: 200 }));
  }) as unknown as typeof fetch;
});
afterAll(() => restoreDomGlobals());

beforeEach(() => {
  mounted.value = null;
  requests.length = 0;
  container = document.body.appendChild(document.createElement('div'));
});
afterEach(() => {
  render(null, container);
  container.remove();
});

/** Render the real hook for one chat and one probe ladder. */
async function mount(sessionId: string, modeChoices = LADDER): Promise<ChatTimelineModes> {
  function Inner() {
    mounted.value = useChatTimelineModes(sessionId, { harness: 'claude', modeChoices });
    return null;
  }
  await act(async () => {
    render(h(Inner, {}), container);
  });
  for (let i = 0; i < 5; i += 1) await act(async () => {});
  return mounted.value as ChatTimelineModes;
}

describe('pendingSessionMode', () => {
  test('an empty ladder is nothing to choose from', () => {
    expect(pendingSessionMode(undefined, 'code')).toBeNull();
    expect(pendingSessionMode({ choices: [] }, 'code')).toBeNull();
  });

  test('an unknown current is EMPTY, never the first advertised value', () => {
    // Drawing `ask` as current would claim a selection the agent never made; the
    // spawn sends nothing and the agent keeps its own default.
    expect(pendingSessionMode({ choices: LADDER }, null)).toEqual({ currentValue: '', values: LADDER });
  });

  test("the probe's own current values stands until the operator picks", () => {
    expect(pendingSessionMode({ choices: LADDER, current: 'code' }, null)?.currentValue).toBe('code');
  });

  test('a pick wins, and a value the agent does not offer is ignored', () => {
    expect(pendingSessionMode({ choices: LADDER, current: 'code' }, 'architect')?.currentValue).toBe('architect');
    // A stale pick from another agent's ladder must not be sent to this one.
    expect(pendingSessionMode({ choices: LADDER, current: 'code' }, 'bypass')?.currentValue).toBe('code');
  });
});

describe('useChatTimelineModes on a pending chat', () => {
  test('draws the picked agent ladder before any session exists', async () => {
    const modes = await mount('new-1');
    expect(modes.sessionMode?.values.map((choice) => choice.value)).toEqual(['ask', 'code', 'architect']);
    // A pending chat has no record to read.
    expect(requests.filter((request) => request.url.includes('/modes'))).toHaveLength(0);
  });

  test('records the pick for the spawn instead of POSTing it', async () => {
    const modes = await mount('new-1');
    await act(async () => modes.onSelectSessionMode?.('architect'));
    const after = mounted.value as ChatTimelineModes;
    expect(after.sessionMode?.currentValue).toBe('architect');
    // The send path reads this ref; the server has heard nothing, because
    // `/api/agent/new-1` answers 404 and the click would silently vanish.
    expect(after.pendingAgentModeRef.current).toBe('architect');
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  });

  test('a pick does not follow the user to another pending chat', async () => {
    const first = await mount('new-1');
    await act(async () => first.onSelectSessionMode?.('code'));
    const other = await mount('new-2');
    expect(other.sessionMode?.currentValue).toBe('');
    expect(other.pendingAgentModeRef.current).toBeNull();
  });

  test('a different agent ladder drops the pick, because it never offered it', async () => {
    const first = await mount('new-1');
    await act(async () => first.onSelectSessionMode?.('architect'));
    const swapped = await mount('new-1', [{ value: 'ask', name: 'Ask' }, { value: 'code', name: 'Code' }]);
    expect(swapped.sessionMode?.currentValue).toBe('');
    expect(swapped.pendingAgentModeRef.current).toBeNull();
  });

  test('a spawned chat draws the LIVE selector, not the probe', async () => {
    // `sess-1` is not pending: the mode surface comes from the session's own
    // record (the route answers {}), so a probe ladder must not stand in for it.
    const modes = await mount('sess-1');
    expect(modes.sessionMode).toBeNull();
    expect(modes.pendingAgentModeRef.current).toBeNull();
  });
});
