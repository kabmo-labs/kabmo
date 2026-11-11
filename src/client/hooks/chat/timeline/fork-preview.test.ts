/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The fork preview's TRANSPORT half: which source it reads, and what happens
 * when "Fork from" moves.
 *
 * The slice itself is asserted in `shared/lib/chat/timeline/fork-preview.test.ts`;
 * this pins the two behaviours the picker depends on — a source switch refetches
 * (the old rows must not stand in for the new source) and a late answer for a
 * source that is no longer selected is dropped, not painted.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { useForkPreview, type ForkPreview } from '@/client/hooks/chat/timeline/fork-preview';
import type { ChatMessageData } from '@/shared/types';

let container: HTMLElement;
let requested: string[];
/** The runner's own fetch: a stub left installed poisons every later suite. */
const originalFetch = Bun.fetch;
interface DeferredResponse {
  promise: Promise<Response>;
  resolve: (value: Response) => void;
}
const gates = new Map<string, DeferredResponse>();

beforeAll(() => installDomGlobals(new Window({ url: 'http://localhost' })));
afterAll(() => restoreDomGlobals());

beforeEach(() => {
  requested = [];
  gates.clear();
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const gate = Promise.withResolvers<Response>();
    gates.set(url, gate);
    return gate.promise;
  }) as typeof fetch;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  render(null, container);
  container.remove();
});

const sessionResponse = (id: string, messages: ChatMessageData[]) =>
  Response.json({ session: { id, messages } });

/** Mounts the hook and records its latest value. */
function mount(source: string | null, anchor: string | null): { current: ForkPreview | null } {
  const state: { current: ForkPreview | null } = { current: null };
  function Probe({ sourceId, anchorId }: { sourceId: string | null; anchorId: string | null }) {
    state.current = useForkPreview(sourceId, anchorId);
    return null;
  }
  act(() => render(h(Probe, { sourceId: source, anchorId: anchor }), container));
  return state;
}

async function settle(): Promise<void> {
  // The fetch chain is microtasks only: drain them deterministically rather
  // than guessing a wall-clock delay.
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

describe('useForkPreview', () => {
  test('reads the whole source transcript and slices it at the anchor', async () => {
    const state = mount('sess-a', 'a1');
    expect(requested).toEqual(['/api/chat/sess-a?limit=all']);

    const gate = gates.get('/api/chat/sess-a?limit=all')!;
    gate.resolve(sessionResponse('sess-a', [
      { id: 'u1', role: 'user', content: 'one' },
      { id: 'a1', role: 'ai', content: 'two' },
      { id: 'u2', role: 'user', content: 'three' },
    ]));
    await settle();

    expect(state.current?.loading).toBe(false);
    expect(state.current?.messages.map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  test('a new "Fork from" refetches and never shows the previous source rows', async () => {
    const state = mount('sess-a', null);
    gates.get('/api/chat/sess-a?limit=all')!.resolve(sessionResponse('sess-a', [
      { id: 'a1', role: 'user', content: 'from A' },
    ]));
    await settle();
    expect(state.current?.messages.map((m) => m.id)).toEqual(['a1']);

    act(() => {
      render(h(function Next() {
        state.current = useForkPreview('sess-b', null);
        return null;
      }, {}), container);
    });
    // The picker moved: A's transcript is gone from the surface immediately.
    expect(state.current?.messages).toEqual([]);
    expect(requested.at(-1)).toBe('/api/chat/sess-b?limit=all');

    gates.get('/api/chat/sess-b?limit=all')!.resolve(sessionResponse('sess-b', [
      { id: 'b1', role: 'user', content: 'from B' },
    ]));
    await settle();
    expect(state.current?.messages.map((m) => m.id)).toEqual(['b1']);
  });

  test('a late answer for an abandoned source is dropped', async () => {
    const state = mount('sess-a', null);
    act(() => {
      render(h(function Next() {
        state.current = useForkPreview('sess-b', null);
        return null;
      }, {}), container);
    });
    gates.get('/api/chat/sess-b?limit=all')!.resolve(sessionResponse('sess-b', [
      { id: 'b1', role: 'user', content: 'from B' },
    ]));
    await settle();
    gates.get('/api/chat/sess-a?limit=all')!.resolve(sessionResponse('sess-a', [
      { id: 'a1', role: 'user', content: 'from A' },
    ]));
    await settle();
    expect(state.current?.messages.map((m) => m.id)).toEqual(['b1']);
  });

  test('a failed read is reported, not replaced with an empty transcript', async () => {
    const state = mount('sess-a', null);
    gates.get('/api/chat/sess-a?limit=all')!.resolve(Response.json({ error: 'not found' }, { status: 404 }));
    await settle();
    expect(state.current?.error).toBe('not found');
    expect(state.current?.messages).toEqual([]);
  });
});
