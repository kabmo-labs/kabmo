/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A tool card is headed by its OWN intent, so the list reads
 * `title1 → card1 → title2 → card2`.
 *
 * The section used to carry ONE title — the intent of the FIRST call, because
 * `parseMessageBlocks` keeps only the first `i` field — while every later call's
 * intent was dropped entirely. With the intent chip also removed from the card
 * header, a turn with two `bash` calls rendered one label above two identical
 * cards, and the second call's purpose was unreachable without opening it.
 *
 * There is deliberately NO group heading and no bulk Expand/Collapse control:
 * the heading could only restate what the cards already say (`Tool Executions
 * (N steps)` counts what is visible, and the first call's sentence belongs to
 * its own card), and the section renders exactly its cards, nothing above them.
 *
 * These pin the ORDER (heading immediately before its card) and that the
 * section's children are only headings and cards.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ToolCallingSection } from '@/client/components/workspace/chat-timeline/ToolCallingSection';
import { SessionStateProvider } from '@/client/components/common/session-state-provider';
import type { ToolCallData } from '@/shared/types/chat';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
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

function tool(id: string, intent: string | undefined, title = 'Bash'): ToolCallData {
  return { id, type: 'bash', name: 'bash', title, intent, status: 'success', output: 'ok' } as ToolCallData;
}

async function mount(tools: ToolCallData[]) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: 'test',
        children: h(ToolCallingSection, { tools }),
      }),
      container,
    );
  });
  return container;
}

/**
 * The section's direct children in render order: intent headings and their
 * cards. A section renders nothing else.
 */
function sequence(el: HTMLElement): Array<{ kind: 'heading' | 'card'; text: string }> {
  const section = el.querySelector('[data-tool-section]')!;
  const items = Array.from(section.children).map((child) => {
    const cls = (child.className || '').toString();
    if (cls.includes('overflow-hidden rounded-xl')) {
      const col = child.querySelector('button')!.children[1];
      return { kind: 'card' as const, text: (col.children[0]?.textContent || '').trim() };
    }
    const label = child.querySelector('span');
    return { kind: 'heading' as const, text: label ? (label.textContent || '').trim() : '' };
  });
  return items.filter((item) => item.kind !== 'heading' || item.text);
}

describe('ToolCallingSection per-card intent heading', () => {
  test('each card is preceded by its own intent', async () => {
    const el = await mount([
      tool('a', 'Finding PWA manifest'),
      tool('b', 'Searching standalone branches'),
    ]);
    expect(sequence(el)).toEqual([
      { kind: 'heading', text: 'Finding PWA manifest' },
      { kind: 'card', text: 'Bash' },
      { kind: 'heading', text: 'Searching standalone branches' },
      { kind: 'card', text: 'Bash' },
    ]);
  });

  test('the section renders only headings and cards, nothing above them', async () => {
    const el = await mount([tool('a', undefined), tool('b', undefined)]);
    expect(sequence(el)).toEqual([
      { kind: 'card', text: 'Bash' },
      { kind: 'card', text: 'Bash' },
    ]);
    // No header row: every direct child is a card.
    const children = Array.from(el.querySelector('[data-tool-section]')!.children) as HTMLElement[];
    expect(children).toHaveLength(2);
    expect(children.every((child) => child.className.includes('overflow-hidden rounded-xl'))).toBe(true);
  });

  test('a card without an intent simply has no heading', async () => {
    const el = await mount([tool('a', 'Has intent'), tool('b', undefined)]);
    expect(sequence(el)).toEqual([
      { kind: 'heading', text: 'Has intent' },
      { kind: 'card', text: 'Bash' },
      { kind: 'card', text: 'Bash' },
    ]);
  });

  test('a long intent heading is clamped to one line with the full text in title', async () => {
    const long = 'x'.repeat(200);
    const el = await mount([tool('a', long)]);
    const heading = el.querySelector('[data-tool-section] > div > span') as HTMLElement;
    expect(heading.textContent).toBe(long);
    expect(heading.className).toContain('truncate');
    expect(heading.className).toContain('min-w-0');
    expect(heading.getAttribute('title')).toBe(long);
  });
});

describe('ToolCallingSection heading rule', () => {
  test('the intent heading rule fills the row, the way a card heading draws it', async () => {
    const el = await mount([tool('a', 'Finding PWA manifest')]);
    const row = el.querySelector('[data-tool-section] > div') as HTMLElement;
    const [label, rule] = Array.from(row.children) as HTMLElement[];
    // The label sizes to its text and the rule takes the remainder, so the line
    // runs to the panel edge. Two `flex-1` items would split the row 50/50 and
    // park a short heading's rule in the middle of it.
    expect(label.className).toContain('truncate');
    expect(label.className).not.toContain('flex-1');
    expect(rule.className).toContain('flex-1');
    expect(rule.className).toContain('h-px');
    // The old fixed width is gone. Asserted as a WORD, because `min-w-6`
    // contains `w-6` as a substring and a naive `toContain` would fail on the
    // guard that keeps the rule from collapsing.
    expect(rule.className.split(' ')).not.toContain('w-6');
  });

  test('the rule keeps a minimum width so a long intent cannot collapse it', async () => {
    const el = await mount([tool('a', 'x'.repeat(400))]);
    const row = el.querySelector('[data-tool-section] > div') as HTMLElement;
    const rule = row.children[1] as HTMLElement;
    expect(rule.className).toContain('min-w-6');
  });
});
