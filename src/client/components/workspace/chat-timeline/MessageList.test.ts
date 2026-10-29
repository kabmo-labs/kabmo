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

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { MessageList } from '@/client/components/workspace/chat-timeline/MessageList';
import type { ChatMessageData } from '@/shared/types';

let container: HTMLElement;

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
/** The runner's own globals, restored on teardown — deleting them would strip natives (Event/CustomEvent) every later file needs. */const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

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

const user = (id: string): ChatMessageData => ({ id, role: 'user', content: 'yo' });
const ai = (id: string): ChatMessageData => ({ id, role: 'ai', content: 'hi' });
/** A row as a JSONL load spells it: omp's developer / custom / toolResult entries. */
const committed = (id: string): ChatMessageData => ({ id, role: 'assistant', content: 'note' });

async function mount(messages: ChatMessageData[], isGenerating: boolean): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(MessageList, { messages, isGenerating }), container);
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
});
