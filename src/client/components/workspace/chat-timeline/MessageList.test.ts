/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Run-footer placement on the rendered timeline.
 *
 * A footer closes a run, so it must not appear on a row that is still
 * streaming. The streaming row is identified positionally (`streamingRowIndex`),
 * but the guard used to also require the row's role to be spelled `ai` — which
 * is only the LIVE mapper's spelling. `roleFor` spells the rows a JSONL load
 * produces for omp's `developer`, `custom` and `toolResult` entries
 * `assistant`, and a run reopened mid-flight has exactly such a row at its tail,
 * so the footer settled on the row the answer was still streaming into. These
 * two mounts pin both spellings, and that the footer lands once the run ends.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { MessageList } from '@/client/components/workspace/chat-timeline/MessageList';
import { SessionStateProvider } from '@/client/components/common/session-state-provider';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { ChatMessageData } from '@/shared/types';

let container: HTMLElement;
/** Every tree this file mounted; unmounted before the window goes away. */
const mounted: HTMLElement[] = [];
/** The runner's own fetch, so a leaked stub cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

beforeAll(() => installDomGlobals(new Window({ url: 'http://localhost' })));

beforeEach(() => {
  // `SessionStateProvider` hydrates the session blob on mount; Bun's fetch
  // cannot resolve the relative URL happy-dom would hand it.
  (globalThis as unknown as Record<string, unknown>).fetch = async () =>
    new Response(JSON.stringify({ sessionId: 'message-list-spec', state: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
});

afterEach(() => {
  // UNMOUNT, not detach: `MessageList` draws `AiMessageFooter`, whose plugin
  // strip subscribes to the list-slot store. A tree left mounted re-renders on
  // that store's next publish — which happens in a LATER file, after
  // `restoreDomGlobals` deleted `document`, and surfaces there as
  // `ReferenceError: document is not defined` in `list-slots.test.ts` on the
  // Windows shard. A detached container is enough for the assertions, but the
  // subscription outlives it.
  for (const node of mounted.splice(0)) render(null, node);
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
});

afterAll(() => restoreDomGlobals());

const user = (id: string): ChatMessageData => ({ id, role: 'user', content: 'yo' });
const ai = (id: string): ChatMessageData => ({ id, role: 'ai', content: 'hi' });
/** A row as a JSONL load spells it: omp's developer / custom / toolResult entries. */
const committed = (id: string): ChatMessageData => ({ id, role: 'assistant', content: 'note' });

async function mount(messages: ChatMessageData[], isGenerating: boolean): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  mounted.push(container);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: 'message-list-spec',
        children: h(MessageList, { messages, isGenerating }),
      }) as never,
      container,
    );
  });
  return container;
}

/** The run footer's own Retry action — the footer's only stable hook. */
const footers = (el: HTMLElement) => el.querySelectorAll('[aria-label="Retry response"]').length;

describe('MessageList run footers', () => {
  test('withholds the footer while the run streams, and lands it once settled', async () => {
    expect(footers(await mount([user('u1'), ai('a1')], true))).toBe(0);
    expect(footers(await mount([user('u1'), ai('a1')], false))).toBe(1);
  });

  test('withholds the footer when the streaming row came from a JSONL load', async () => {
    const messages = [user('u1'), ai('a1'), committed('d1')];
    expect(footers(await mount(messages, true))).toBe(0);
    expect(footers(await mount(messages, false))).toBe(1);
  });
});

/**
 * A thinking block opens for the whole LIVE RUN, not only while its own
 * segment streams. A warm session delivers the first `message_update` and its
 * `message_end` inside one animation frame, so the block mounts already
 * finalized; keying the default on the segment's own flag left it collapsed
 * for the rest of the run (the reported "thinking sometimes does not open").
 */
describe('MessageList live-run thinking', () => {
  const thinkingRow = (id: string, isGenerating: boolean): ChatMessageData => ({
    id,
    role: 'ai',
    content: '',
    thinking: { thought: 'hmm', isGenerating },
  });
  const expanded = (el: HTMLElement) =>
    el.querySelector<HTMLButtonElement>('button[aria-expanded]')?.getAttribute('aria-expanded');

  test('a finalized thinking segment after the last user turn opens', async () => {
    const el = await mount([user('u1'), thinkingRow('a1', false)], true);
    expect(expanded(el)).toBe('true');
  });

  test('a historical thinking block stays closed while a later run streams', async () => {
    const el = await mount(
      [user('u1'), thinkingRow('a1', false), user('u2'), thinkingRow('a2', false)],
      true,
    );
    const toggles = el.querySelectorAll<HTMLButtonElement>('button[aria-expanded]');
    expect(toggles[0]?.getAttribute('aria-expanded')).toBe('false');
    expect(toggles[1]?.getAttribute('aria-expanded')).toBe('true');
  });
});

/**
 * The mounted window.
 *
 * Every row used to stay in the DOM for the life of the session, and paging
 * history only ever added: measured on a 9.4 MB session, ten pages was 107 807
 * nodes and 891 MB of WebContent footprint, with nothing released when the
 * reader scrolled away. The list therefore mounts only the rows around the
 * viewport, and the two spacers carry the height of everything else — the
 * scrollbar must still describe the whole session.
 */
describe('MessageList mounted window', () => {
  const window = (start: number, end: number, padTop: number, padBottom: number) => ({
    start,
    end,
    padTop,
    padBottom,
    revealRow: async () => {},
  });

  async function mountWindowed(messages: ChatMessageData[], rowWindow: ReturnType<typeof window>): Promise<HTMLElement> {
    container = document.createElement('div');
    document.body.appendChild(container);
    mounted.push(container);
    await act(async () => {
      render(h(MessageList, { messages, isGenerating: false, rowWindow }), container);
    });
    return container;
  }

  test('mounts only the rows inside the window', async () => {
    const messages = Array.from({ length: 10 }, (_, i) => user(`u${i}`));
    const el = await mountWindowed(messages, window(4, 7, 480, 360));
    expect([...el.querySelectorAll('[data-row-id]')].map((node) => node.getAttribute('data-row-id'))).toEqual([
      'u4',
      'u5',
      'u6',
    ]);
  });

  test('the spacers carry the height of the rows that are not mounted', async () => {
    const messages = Array.from({ length: 10 }, (_, i) => user(`u${i}`));
    const el = await mountWindowed(messages, window(4, 7, 480, 360));
    const spacers = [...el.querySelectorAll<HTMLElement>('[data-timeline-spacer]')];
    expect(spacers.map((node) => node.style.height)).toEqual(['480px', '360px']);
  });

  test('a window that covers everything renders no spacers', async () => {
    const el = await mountWindowed([user('u1'), ai('a1')], window(0, 2, 0, 0));
    expect(el.querySelectorAll('[data-timeline-spacer]').length).toBe(0);
    expect(el.querySelectorAll('[data-row-id]').length).toBe(2);
  });

  test('the window keeps the run footer of a row it mounts', async () => {
    const messages = [user('u1'), ai('a1'), user('u2'), ai('a2')];
    // Only the settled run at rows 0..1 is mounted.
    const el = await mountWindowed(messages, window(0, 2, 0, 500));
    expect(footers(el)).toBe(1);
  });

  test('an errored answer renders the failure instead of an empty bubble', async () => {
    const el = await mount([
      user('u1'),
      {
        id: 'a1',
        role: 'ai',
        content: '',
        error: { message: 'The agent ended the turn without sending an answer' },
      },
    ], false);
    expect(el.textContent).toContain('Request Failed');
    expect(el.textContent).toContain('without sending an answer');
  });
});
