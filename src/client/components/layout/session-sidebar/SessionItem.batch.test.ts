/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The row's batch-mode switch, on both layouts.
 *
 * Two properties decide whether the feature is usable at all: in select mode a
 * click must TOGGLE the selection rather than open the session (otherwise the
 * checkbox is decorative and every tap navigates away), and the row's own
 * actions must be gone (an action beside a checkbox is a second thing the click
 * could mean). The rows draw these from one prop set, so both layouts are
 * asserted here rather than trusted to match.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SessionItem } from '@/client/components/layout/session-sidebar/SessionItem';
import type { SessionItemProps } from '@/client/components/layout/session-sidebar/SessionItem';
import { MobileSessionRow } from '@/client/components/mobile/mobile-session-sidebar/SessionRow';
import type { MobileSessionRowProps } from '@/client/components/mobile/mobile-session-sidebar/SessionRow';
import type { SessionItemData } from '@/shared/types';

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

afterEach(() => {
  container?.remove();
});

async function mountDesktop(overrides: Partial<SessionItemProps> = {}) {
  const calls = { click: 0, toggle: 0, actions: 0 };
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(SessionItem, {
      sessionId: 's1',
      title: 'hello world',
      onClick: () => { calls.click += 1; },
      onRename: () => {},
      onDelete: () => {},
      ...overrides,
      ...(overrides.selectable ? { onToggleSelect: () => { calls.toggle += 1; } } : {}),
    }), container);
  });
  return { el: container, calls };
}

const session: SessionItemData = { id: 's1', folder_id: 1, title: 'hello world' };

async function mountMobile(overrides: Partial<MobileSessionRowProps> = {}) {
  const calls = { select: 0, toggle: 0 };
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(MobileSessionRow, {
      session,
      isActive: false,
      timeAgo: null,
      onSelect: () => { calls.select += 1; },
      onArchive: () => {},
      onDelete: () => {},
      onRename: () => {},
      ...overrides,
      ...(overrides.selectable ? { onToggleSelect: () => { calls.toggle += 1; } } : {}),
    }), container);
  });
  return { el: container, calls };
}

function checkbox(el: HTMLElement): HTMLInputElement | null {
  return el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
}

describe('desktop row batch mode', () => {
  test('no checkbox while the sidebar is not selecting', async () => {
    const { el } = await mountDesktop();
    expect(checkbox(el)).toBeNull();
    expect(el.querySelector('[data-selected]')).toBeNull();
  });

  test('draws a checkbox named after the row', async () => {
    const { el } = await mountDesktop({ selectable: true });
    expect(checkbox(el)?.getAttribute('aria-label')).toBe('Select hello world');
  });

  test('a click toggles the selection instead of opening the session', async () => {
    const { el, calls } = await mountDesktop({ selectable: true });
    const row = el.querySelector('[data-testid="session-item"]') as HTMLElement;
    await act(async () => { row.click(); });
    expect(calls.toggle).toBe(1);
    expect(calls.click).toBe(0);
  });

  test('the checkbox click does not also fire the row', async () => {
    const { el, calls } = await mountDesktop({ selectable: true });
    await act(async () => { checkbox(el)?.click(); });
    expect(calls.toggle).toBe(1);
    expect(calls.click).toBe(0);
  });

  test('marks the selected row for styling and hides its actions', async () => {
    const { el } = await mountDesktop({ selectable: true, selected: true });
    const row = el.querySelector('[data-testid="session-item"]') as HTMLElement;
    expect(row.getAttribute('data-selected')).toBe('true');
    expect(checkbox(el)?.checked).toBe(true);
    expect(el.querySelector('button[aria-label="Session actions"]')).toBeNull();
  });

  test('the normal row still opens the session and keeps its actions', async () => {
    const { el, calls } = await mountDesktop();
    const row = el.querySelector('[data-testid="session-item"]') as HTMLElement;
    await act(async () => { row.click(); });
    expect(calls.click).toBe(1);
    expect(el.querySelector('button[aria-label="Session actions"]')).not.toBeNull();
  });
});

describe('mobile row batch mode', () => {
  test('no checkbox while the drawer is not selecting', async () => {
    const { el } = await mountMobile();
    expect(checkbox(el)).toBeNull();
  });

  test('a tap toggles the selection instead of opening the session', async () => {
    const { el, calls } = await mountMobile({ selectable: true });
    const row = el.querySelector('[data-testid="session-item"]') as HTMLElement;
    await act(async () => { row.querySelector('button')?.click(); });
    expect(calls.toggle).toBe(1);
    expect(calls.select).toBe(0);
  });

  test('hides the row actions and the roster toggle in select mode', async () => {
    const { el } = await mountMobile({ selectable: true, hasSubagents: true, onToggleExpand: () => {} });
    expect(el.querySelector('button[aria-label="Session actions"]')).toBeNull();
    expect(el.querySelector('button[aria-label*="subagents"]')).toBeNull();
    expect(checkbox(el)?.getAttribute('aria-label')).toBe('Select hello world');
  });
});
