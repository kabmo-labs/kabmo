/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The agent browser's tab strip, and the close control that makes it usable.
 *
 * Why this exists at all: omp opens a page per site and never tidies up, and
 * the viewer follows the NEWEST owned tab — so a stale page keeps stealing the
 * panel. The strip is the only map of those pages, which makes it the only
 * place they can be closed.
 *
 * Pinned here: one close control per tab, the ACTIVE tab's control stays visible
 * (a hover-only control is unreachable on a touch screen and the active tab is
 * the one most likely to be closed), a click closes THAT tab and does not
 * bubble into a select, and the tab being closed has its control disabled.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { BrowserTabStrip } from '@/client/components/workspace/browser-panel/TabStrip';
import type { BrowserTabInfo } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let container: HTMLElement | undefined;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
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
  if (container) render(null, container);
  container?.remove();
  container = undefined;
});

const TABS: BrowserTabInfo[] = [
  { targetId: 't1', url: 'https://one.test', title: 'One' },
  { targetId: 't2', url: 'https://two.test', title: 'Two' },
  { targetId: 't3', url: 'https://three.test', title: 'Three' },
];

interface Recorder {
  selected: string[];
  closed: string[];
}

async function mount(props: { targetId?: string; closing?: string | null } = {}): Promise<{ host: HTMLElement; seen: Recorder }> {
  const seen: Recorder = { selected: [], closed: [] };
  const host = document.body.appendChild(document.createElement('div'));
  container = host;
  await act(async () => {
    render(
      h(BrowserTabStrip, {
        tabs: TABS,
        targetId: props.targetId ?? 't2',
        closing: props.closing ?? null,
        onSelectTarget: (id) => seen.selected.push(id),
        onCloseTarget: (id) => seen.closed.push(id),
      }),
      host,
    );
  });
  return { host, seen };
}

const closeButtons = (host: HTMLElement): HTMLButtonElement[] =>
  [...host.querySelectorAll('button')].filter((button) => button.getAttribute('aria-label')?.startsWith('Tutup tab '));

describe('BrowserTabStrip', () => {
  test('every tab gets a close control named for that tab', async () => {
    const { host } = await mount();
    const buttons = closeButtons(host);
    expect(buttons).toHaveLength(TABS.length);
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Tutup tab One',
      'Tutup tab Two',
      'Tutup tab Three',
    ]);
  });

  test('a close click names exactly that tab', async () => {
    const { host, seen } = await mount();
    const second = closeButtons(host)[1];
    await act(async () => {
      second.click();
    });
    expect(seen.closed).toEqual(['t2']);
    // Closing must not also select: the panel re-points the viewer itself once
    // the server confirms, and a select here would fight that.
    expect(seen.selected).toEqual([]);
  });

  test('the active tab keeps its close control visible', async () => {
    const { host } = await mount({ targetId: 't2' });
    const [first, second, third] = closeButtons(host);
    // The inactive ones reveal on hover/focus only.
    expect(first.className).toContain('opacity-0');
    expect(third.className).toContain('opacity-0');
    // The active one does not, so a touch user can still close it.
    expect(second.className).not.toContain('opacity-0');
  });

  test('the tab being closed has its control disabled', async () => {
    const { host } = await mount({ closing: 't3' });
    expect(closeButtons(host)[2].disabled).toBe(true);
    expect(closeButtons(host)[0].disabled).toBe(false);
  });

  test('selecting a tab still works, and the active one unpins to follow newest', async () => {
    const { host, seen } = await mount({ targetId: 't2' });
    const select = (index: number) => [...host.querySelectorAll('button')].filter((b) => b.getAttribute('aria-pressed') !== null)[index];
    await act(async () => {
      select(0).click();
    });
    await act(async () => {
      select(1).click();
    });
    expect(seen.selected).toEqual(['t1', '']);
  });

  test('a tab with no title falls back to its URL, then its id', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    container = host;
    await act(async () => {
      render(
        h(BrowserTabStrip, {
          tabs: [
            { targetId: 'a', url: 'https://url-only.test', title: '' },
            { targetId: 'b', url: '', title: '' },
          ],
          onSelectTarget: () => {},
          onCloseTarget: () => {},
        }),
        host,
      );
    });
    expect(host.textContent).toContain('https://url-only.test');
    expect(host.textContent).toContain('b');
  });
});
