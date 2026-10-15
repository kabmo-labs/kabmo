/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The rail's hit target.
 *
 * The reported bug: hovering a tick showed the tooltip, but the cursor stayed
 * an arrow and the click did nothing unless the pointer was nudged until the
 * cursor changed. The cause was geometry — the 1px line the user aims at sat
 * dead-centre of a 24x7 row as its OWN element, with no handler and no
 * `cursor` rule, so it swallowed the pointer over the middle of the target.
 *
 * happy-dom computes no layout, so this pins the STRUCTURE that makes the
 * geometry correct: one button spanning the whole row (so no child can be the
 * only element under the pointer), the visual line as a non-interactive span
 * inside it, and every row's button wired to that row's turn. The rendered
 * pixel behaviour is covered by the browser check recorded in AGENTS.md.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { MinimapShortcuts } from '@/client/components/workspace/chat-timeline/MinimapShortcuts';
import type { UserTurnRef } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let container: HTMLElement | undefined;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
});

const turns: UserTurnRef[] = [
  { id: 't1', index: 0, preview: 'first' },
  { id: 't2', index: 1, preview: 'second' },
  { id: 't3', index: 2, preview: 'third' },
];

async function mount(onJumpTurn: (turn: UserTurnRef) => void = () => {}): Promise<HTMLElement> {
  container = document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(h(MinimapShortcuts, { turns, jumping: false, onJumpTurn }), container as HTMLElement);
  });
  return container;
}

describe('MinimapShortcuts hit target', () => {
  test('every row is covered by one button, so the 1px line cannot be the only element hit', async () => {
    const el = await mount();
    const nav = el.querySelector('[aria-label^="Jump to your message ("]');
    expect(nav).not.toBeNull();
    const rows = Array.from((nav as HTMLElement).children);
    expect(rows).toHaveLength(turns.length);
    for (const row of rows) {
      const buttons = row.querySelectorAll('button');
      // Exactly one control per row, and it spans the row.
      expect(buttons).toHaveLength(1);
      expect(buttons[0].className).toContain('absolute');
      expect(buttons[0].className).toContain('inset-0');
      expect(buttons[0].className).toContain('cursor-pointer');
    }
  });

  test('the visual line is decorative, so it never swallows the pointer', async () => {
    const el = await mount();
    const nav = el.querySelector('[aria-label^="Jump to your message ("]') as HTMLElement;
    const line = nav.children[0].querySelector('span');
    expect(line).not.toBeNull();
    expect(line!.getAttribute('aria-hidden')).toBe('true');
    // `pointer-events-none` is what makes the whole row one target: without it
    // the span sits over the button's own pixels.
    expect(line!.className).toContain('pointer-events-none');
  });

  test('each row jumps to its own turn', async () => {
    const jumped: UserTurnRef[] = [];
    const el = await mount((turn) => jumped.push(turn));
    const nav = el.querySelector('[aria-label^="Jump to your message ("]') as HTMLElement;
    const buttons = Array.from(nav.querySelectorAll('button'));
    expect(buttons).toHaveLength(turns.length);
    for (const button of buttons) {
      await act(async () => { button.click(); });
    }
    expect(jumped.map((turn) => turn.id)).toEqual(['t1', 't2', 't3']);
  });

  test('the row label names the turn, so the control is reachable by keyboard and name', async () => {
    const el = await mount();
    const nav = el.querySelector('[aria-label^="Jump to your message ("]') as HTMLElement;
    const buttons = Array.from(nav.querySelectorAll('button'));
    expect(buttons[0].getAttribute('aria-label')).toBe(`Jump to your message #1 of ${turns.length}`);
    expect(buttons[2].getAttribute('aria-label')).toBe(`Jump to your message #3 of ${turns.length}`);
  });
});
