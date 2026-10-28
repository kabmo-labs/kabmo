/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Queue row actions must be reachable without a cursor.
 *
 * The row's Send Now / Edit / Remove buttons are written
 * `opacity-0 group-hover:opacity-100`, and Tailwind v4 emits `group-hover:`
 * inside `@media (hover: hover)`. A phone reports `hover: none`, so the rule
 * never applies and the buttons stayed at zero opacity — present in the DOM,
 * invisible, and impossible to tap. The fix is the `touch-visible` class, whose
 * `@media (hover: none)` rule lives in `tailwind.css` (its emission is pinned
 * by `css.test.ts`); what these mounts pin is that every action the row renders
 * actually CARRIES it, so a future row cannot be added hover-only.
 *
 * The class is asserted rather than a computed opacity because happy-dom does
 * not resolve the media query — the stylesheet's own behaviour is covered by
 * the bundler test, and this file covers the markup that must opt into it.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { QueueList } from '@/client/components/workspace/chat-timeline/QueueList';
import type { QueuedMessage } from '@/shared/types';

let container: HTMLElement;

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

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

const item = (id: string, text: string): QueuedMessage => ({ id, text, attachments: [], model: null });

async function mount(props: Record<string, unknown>): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(QueueList, { queue: [item('q1', 'queued message')], ...props }), container);
  });
  return container;
}

describe('QueueList touch reachability', () => {
  test('every row action opts into the no-cursor reveal', async () => {
    const el = await mount({ onSendNow: () => {}, onEdit: () => {}, onRemove: () => {} });
    const actions = [...el.querySelectorAll('button[title]')];
    expect(actions.length).toBe(3);
    for (const action of actions) {
      expect(action.className).toContain('touch-visible');
    }
  });

  test('an action the caller did not supply is not rendered', async () => {
    const el = await mount({ onRemove: () => {} });
    expect(el.querySelectorAll('button[title]').length).toBe(1);
  });

  test('Send Now is offered whenever the caller supplies it', async () => {
    const el = await mount({ onSendNow: () => {} });
    expect(el.querySelector('[title="Send Now (Steering)"]')).not.toBeNull();
  });
});
