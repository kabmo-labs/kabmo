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
