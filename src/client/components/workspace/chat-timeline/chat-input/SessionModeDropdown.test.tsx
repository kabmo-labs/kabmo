/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ACP mode chip: hidden when there is nothing to choose, and it reports the
 * chosen value. Rendered with `h()` against happy-dom.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { SessionModeDropdown } from '@/client/components/workspace/chat-timeline/chat-input/SessionModeDropdown';
import type { SessionModeState } from '@/shared/lib/harness/session-modes';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement | undefined;

const TWO_MODES: SessionModeState = {
  currentValue: 'ask',
  values: [{ value: 'ask', name: 'Ask' }, { value: 'code', name: 'Code' }],
};

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
  container = undefined;
});

async function mount(mode: SessionModeState | null, onSelect: (value: string) => void = () => {}) {
  container ??= document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(h(SessionModeDropdown, { mode, pending: false, onSelect }), container as HTMLElement);
  });
  return container;
}

describe('SessionModeDropdown', () => {
  test('renders nothing for a harness with no selector or one value', async () => {
    expect((await mount(null)).textContent).toBe('');
    await mount({ currentValue: 'ask', values: [{ value: 'ask', name: 'Ask' }] });
    expect(container?.textContent).toBe('');
  });

  test('names the current mode and reports a pick', async () => {
    const picks: string[] = [];
    const el = await mount(TWO_MODES, (value) => picks.push(value));
    const trigger = el.querySelector('button[aria-haspopup="listbox"]');
    expect(trigger?.getAttribute('aria-label')).toBe('Session mode: Ask');

    await act(async () => {
      (trigger as HTMLButtonElement).click();
    });
    const options = el.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(2);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');

    await act(async () => {
      (options[1] as HTMLButtonElement).click();
    });
    expect(picks).toEqual(['code']);
    expect(el.querySelector('[role="listbox"]')).toBeNull();
  });

  test('a chat that has not spawned says "Mode", not an empty chip', async () => {
    // The ladder comes from the harness probe, which names the values but not
    // always which one is current; an empty label read as a broken control
    // beside a working list.
    const el = await mount({ currentValue: '', values: TWO_MODES.values });
    const trigger = el.querySelector('button[aria-haspopup="listbox"]');
    expect(trigger?.getAttribute('aria-label')).toBe('Session mode: Mode');
  });
});
