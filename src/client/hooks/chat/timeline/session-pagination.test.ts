/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The prepend anchor vs. a bottom jump. The anchor exists to hold a READING
 * position when older history is paged in above the viewport, and it writes
 * `scrollTop` directly (which CSS `scroll-behavior: smooth` then animates). A
 * window that landed after the user asked for the tail therefore wrote
 * `scrollTop` straight over the jump: reproduced live in Kabmo against a
 * session with older pages — the viewport stopped ~26k px short of the tail
 * (the anchor's own target), and only the next click reached the bottom, once
 * no window was left to page in.
 *
 * Runs against a real DOM (happy-dom) because the hook is a Preact hook;
 * geometry and `fetch` are faked (happy-dom does no layout and no network).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { Dispatch, SetStateAction } from 'preact/compat';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import type { useSessionPagination as UsePagination, SessionPagination } from '@/client/hooks/chat/timeline/session-pagination';
import type { ChatMessageData } from '@/shared/types';

let useSessionPagination: typeof UsePagination;
let h: typeof PreactH;
let render: typeof PreactRender;
let act: typeof PreactAct;

let win: Window;
let container: HTMLDivElement;
let scrollEl: HTMLDivElement;
/** Prepend this many pixels of older rows when the stubbed window resolves. */
let prependHeightPx = 1000;
let fetchCount = 0;

const geometry = { top: 0, height: 5000, viewport: 500 };

function installScroller(el: HTMLDivElement) {
  Object.defineProperty(el, 'scrollHeight', { get: () => geometry.height, configurable: true });
  Object.defineProperty(el, 'clientHeight', { get: () => geometry.viewport, configurable: true });
  Object.defineProperty(el, 'scrollTop', {
    get: () => geometry.top,
    set: (value: number) => {
      geometry.top = Math.max(0, Math.min(value, geometry.height - geometry.viewport));
    },
    configurable: true,
  });
  Object.defineProperty(el, 'scrollTo', { value: () => {}, configurable: true });
}

/** The two refs the scroll hook owns and the pagination hook reads. */
const jumpActiveRef = { current: false };
const jumpCountRef = { current: 0 };
const sessionIdRef = { current: 's1' };
const scrollRef: { current: HTMLDivElement | null } = { current: null };
/** The hook prepends through this; the commit under test comes from its own
 *  prepend tick, so recording the update is all this needs to do. */
const setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>> = () => {};

let pagination: SessionPagination;

function Probe() {
  pagination = useSessionPagination({
    sessionId: 's1',
    sessionIdRef,
    setLocalMessages,
    scrollRef,
    jumpActiveRef,
    jumpCountRef,
  });
  return null;
}

/** A window that prepends `prependHeightPx` of older rows when it lands. */
function stubWindowFetch() {
  (globalThis as Record<string, unknown>).fetch = async () => {
    fetchCount += 1;
    // The prepend commit is where the anchor reads the new scrollHeight.
    geometry.height += prependHeightPx;
    return {
      ok: true,
      json: async () => ({
        session: { messages: [{ id: 'old-1', role: 'user', content: 'old' }] },
        hasMore: false,
        oldestIndex: 0,
      }),
    };
  };
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
}

beforeAll(async () => {
  win = new Window({ url: 'http://localhost' });
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const) {
    (globalThis as Record<string, unknown>)[key] = (win as unknown as Record<string, unknown>)[key];
  }
  // Static imports cannot work here: Preact binds its environment at module
  // evaluation time, so the modules below must load after those DOM globals.
  ({ useSessionPagination } = await import('@/client/hooks/chat/timeline/session-pagination'));
  ({ h, render } = await import('preact'));
  ({ act } = await import('preact/test-utils'));
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).fetch;
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event']) {
    delete (globalThis as Record<string, unknown>)[key];
  }
});

beforeEach(async () => {
  geometry.top = 0;
  geometry.height = 5000;
  fetchCount = 0;
  jumpActiveRef.current = false;
  jumpCountRef.current = 0;
  stubWindowFetch();
  container = document.createElement('div');
  document.body.appendChild(container);
  scrollEl = document.createElement('div');
  installScroller(scrollEl);
  scrollRef.current = scrollEl;
  await act(async () => { render(h(Probe, {}), container); });
  await act(async () => { pagination.applyWindow(true, 100); });
});

describe('prepend anchor vs bottom jump', () => {
  test('holds the reading position when the user has not asked for the tail', async () => {
    await act(async () => { pagination.loadOlder(); });
    await settle();

    expect(fetchCount).toBe(1);
    expect(geometry.height).toBe(6000);
    // prevTop (0) + the prepended height: the rows being read stay put.
    expect(scrollEl.scrollTop).toBe(1000);
  });

  test('is dropped when the user asked for the tail after the request went out', async () => {
    const requested = pagination.loadOlder();
    // The user clicks scroll-to-bottom while the window is still in flight.
    jumpCountRef.current += 1;
    await requested;
    await settle();

    expect(fetchCount).toBe(1);
    expect(geometry.height).toBe(6000);
    // The jump owns the position; the anchor wrote nothing over it.
    expect(scrollEl.scrollTop).toBe(0);
  });

  test('a jump in flight blocks the paging trigger', async () => {
    jumpActiveRef.current = true;
    await act(async () => { pagination.loadOlder(); });
    await settle();

    expect(fetchCount).toBe(0);
    expect(geometry.height).toBe(5000);
  });
});
