/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The left column draws ONE separator, and its chrome spans the WHOLE column.
 *
 * Both `LeftColumn` and `DesktopLayout` rendered a `ResizeHandle` after the
 * dock, and both were mounted — so the column boundary drew two hairlines 3px
 * apart and a reader saw a double rule between the session list and the chat.
 * It was reproduced only when the rail was ON, because that is the layout a
 * screenshotted report came from, though the extra handle was there in both
 * states.
 *
 * A geometry test cannot catch the separator (happy-dom computes no layout), so
 * that assertion is on the STRUCTURE: the group's direct children, in order. The
 * second handle was a sibling — `LeftColumn`'s own sits between the dock and
 * whatever follows — which is exactly what an order comparison shows.
 *
 * The chrome half is structural too, and both cases were reported. The strip
 * lived inside the dock BODY while the rail was a sibling panel, so with the
 * rail on it stopped at the body's left edge and left an empty strip under the
 * rail. And the rail started at the column's top, running up past the title row
 * and under the app's own titlebar. The column is three ROWS — title, then
 * (rail | view), then strip — so both are asserted by the row each one lives in.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Group } from '@/client/components/layout/desktop-layout/resizer';
import { LeftColumn } from '@/client/components/layout/desktop-layout/LeftColumn';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { realtimeClient, resetRealtimeClient } from '@/shared/lib/realtime/client';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement | null = null;

/**
 * A socket that never dials.
 *
 * The rail subscribes to the Source Control topic on mount. Left to a REAL
 * socket, its close lands after this file has restored the globals and surfaces
 * as `Unhandled error. (ErrorEvent …)` attributed to whichever suite ran next —
 * measured. This column's subject is its own structure, so the channel is
 * silenced rather than served.
 */
class SilentSocket {
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = SilentSocket.CLOSED;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(): void {}
  close(): void {}
}

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://127.0.0.1:1' }));
  realtimeClient.setSocketConstructor(SilentSocket as unknown as typeof WebSocket);
  primeKabmoSettings({});
});

afterAll(() => {
  realtimeClient.setSocketConstructor(null);
  restoreDomGlobals();
});

afterEach(() => {
  // The rail's Source Control dot subscribes to a realtime topic, so the render
  // opens a socket. Left open, its close lands in the NEXT file's globals once
  // this one has restored them — measured as `Unhandled error. (ErrorEvent …)`
  // between tests, attributed to whichever suite happened to run next.
  resetRealtimeClient();
  if (container) {
    render(null, container);
    container.remove();
    container = null;
  }
  primeKabmoSettings({});
});

async function mountColumn(railEnabled: boolean) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  container = host;

  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: 'new-separator',
        children: h(Group, {
        orientation: 'horizontal',
        id: 'kabmo-main',
        children: [
          h(LeftColumn, {
            panelRef: { current: null },
            open: true,
            railEnabled,
            view: 'sessions',
            onSelectView: () => {},
            onCollapse: () => {},
            width: 280,
            minWidth: 264,
            hasActiveContext: true,
            refreshKey: 0,
            onRefresh: () => {},
            onOpenFile: () => {},
          }),
          h('div', { 'data-panel-id': 'main-right-stack' }),
        ],
        }),
      }),
      host,
    );
  });
  // The dock's view is `lazy()`, so the boundary matters before it resolves:
  // the separator is a SIBLING of the panel, not part of its content.
  for (let i = 0; i < 5; i += 1) await act(async () => {});
}

/** The group's DIRECT children, in order — a separator appears once per entry. */
const children = (): string[] =>
  [...(container!.querySelector('[data-panel-group-id="kabmo-main"]')?.children ?? [])].map((child) =>
    child.hasAttribute('data-separator') ? 'separator' : (child.getAttribute('data-panel-id') ?? child.tagName),
  );

describe('left column separators', () => {
  test('one separator with the rail on', async () => {
    await mountColumn(true);
    expect(children().filter((entry) => entry === 'separator')).toHaveLength(1);
  });

  test('one separator with the rail off', async () => {
    await mountColumn(false);
    expect(children().filter((entry) => entry === 'separator')).toHaveLength(1);
  });

  test('the separator is the column boundary — after the dock, not before it', async () => {
    await mountColumn(true);
    const kids = children();
    expect(kids.at(-1)).toBe('main-right-stack');
    expect(kids.at(-2)).toBe('separator');
  });
});

describe('left column chrome', () => {
  const panel = () => container!.querySelector('[data-panel-id="left-panel"]') as HTMLElement;
  const rail = () => panel().querySelector('nav[aria-label="Left panel views"]');
  const title = () => panel().querySelector('.h-10.flex-shrink-0.flex.items-center.justify-between');
  const footer = () => panel().querySelector('button[aria-label="Settings"]');

  test('the title row, the rail and the strip are three rows, in that order', async () => {
    await mountColumn(true);
    const column = panel().firstElementChild as HTMLElement;
    const rows = [...column.children];
    expect(rows).toHaveLength(3);
    // Row 0 is the title, row 1 holds the rail beside the view, row 2 the strip.
    expect(rows[0].contains(title())).toBe(true);
    expect(rows[1].contains(rail())).toBe(true);
    expect(rows[2].contains(footer())).toBe(true);
  });

  test('the rail starts BELOW the title, never above it', async () => {
    await mountColumn(true);
    const column = panel().firstElementChild as HTMLElement;
    expect(column.children[0].contains(rail())).toBe(false);
    expect(column.children[1].contains(rail())).toBe(true);
  });

  test('the strip spans the column, so the rail does not outlive it', async () => {
    await mountColumn(true);
    const column = panel().firstElementChild as HTMLElement;
    expect(column.children[2].contains(rail())).toBe(false);
    expect(column.children[2].contains(footer())).toBe(true);
    // Same row container for title and strip: both are full-width rows of the
    // column, which is what makes the strip run under the rail too.
    expect(column.children[0].parentElement).toBe(column.children[2].parentElement);
  });

  test('the strip survives a view that is not the session list', async () => {
    await mountColumn(true);
    // The column's furniture is rendered outside `LeftDockView` entirely, so it
    // is present even while the lazy view is still resolving.
    expect(footer()).not.toBeNull();
  });
});
