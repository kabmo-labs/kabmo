/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `modern` row: the same facts, the same names, the same contract.
 *
 * The style setting only swaps CHROME, so a row that loses an accessible name,
 * a testid or a status label when it moves from `SessionItem` to `SessionRow`
 * would break every browser spec and every screen-reader query without breaking
 * the build. These assertions are the seam that keeps the two rows
 * interchangeable, and each one names something a spec or a user relies on:
 *
 * - `data-testid="session-item"` scopes a list query;
 * - `aria-label="Session actions"` is how a row's menu is found by role;
 * - the run/blocked/held cues keep their `role="status"` labels;
 * - the trailing slot keeps the age readable at rest and the trigger reachable
 *   by keyboard (opacity only — never `display: none`).
 *
 * Rendered with `h()` (no JSX) against happy-dom, following
 * `session-sidebar/SessionItem.test.ts`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SessionRow } from '@/client/components/common/session-row';
import type { SessionRowProps } from '@/client/components/common/session-row';
import { setSessionRenaming } from '@/client/hooks/workspace/renaming-sessions';

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
  if (container) render(null, container);
  container?.remove();
  setSessionRenaming('s1', false);
});

async function mount(overrides: Partial<SessionRowProps> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(SessionRow, { sessionId: 's1', title: 'hello world', ...overrides }), container);
  });
  return container;
}

describe('modern session row', () => {
  test('keeps the testid and the session id every list query scopes on', async () => {
    const el = await mount();
    const row = el.querySelector('[data-testid="session-item"]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('data-session-id')).toBe('s1');
  });

  test('capitalises the title the way both shipped rows do', async () => {
    const el = await mount({ title: 'hello world' });
    expect(el.textContent).toContain('Hello world');
  });

  test('a live run keeps a labelled status cue', async () => {
    const el = await mount({ status: 'stream' });
    expect(el.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Running');
  });

  test('an agent blocked on a question is announced before any run cue', async () => {
    const el = await mount({ status: 'stream', awaitingInput: true });
    // The blocked cue is a pulse, not a spinner, and it carries no status role —
    // the desktop row has always drawn it that way; what must not change is that
    // it REPLACES the spinner rather than sitting beside it.
    expect(el.querySelector('[role="status"]')).toBeNull();
    expect(el.querySelector('.animate-pulse')).not.toBeNull();
  });

  test('a held prompt says what it is waiting for', async () => {
    const el = await mount({ waitingFor: { title: 'other chat' } });
    expect(el.textContent).toContain('waiting for other chat');
    expect(el.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Waiting for other chat');
  });

  test('an in-flight rename answers the click that is still pending', async () => {
    setSessionRenaming('s1', true);
    const el = await mount();
    expect(el.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Generating a name…');
  });

  test('the actions trigger is drawn and named, and is not hidden from the keyboard', async () => {
    const el = await mount({ onRename: () => {} });
    const trigger = el.querySelector('[aria-label="Session actions"]');
    expect(trigger).not.toBeNull();
    // Hidden by opacity, never by `hidden`/`display`, so Tab still reaches it.
    expect(trigger?.hasAttribute('hidden')).toBe(false);
    expect(trigger?.getAttribute('style') ?? '').not.toContain('display: none');
  });

  test('the trailing slot keeps the age at rest', async () => {
    const el = await mount({ timeAgo: '2m', onRename: () => {} });
    expect(el.textContent).toContain('2m');
  });

  test('batch mode swaps the status slot for the checkbox', async () => {
    const el = await mount({ selectable: true, selected: true, status: 'stream' });
    expect(el.querySelector('input[type="checkbox"]')).not.toBeNull();
    // The run cue and the checkbox are never both drawn: in this mode the row
    // is a choice, not a status report.
    expect(el.querySelector('[role="status"]')).toBeNull();
    expect(el.querySelector('[data-testid="session-item"]')?.getAttribute('data-selected')).toBe('true');
  });

  test('the touch density draws the trigger without a hover reveal', async () => {
    const el = await mount({ density: 'touch', onRename: () => {}, timeAgo: '5m' });
    const trigger = el.querySelector('[aria-label="Session actions"]');
    expect(trigger?.className ?? '').not.toContain('opacity-0');
    expect(el.textContent).toContain('5m');
  });

  test('the touch row is as tall as the folder header, and can still grow', async () => {
    const el = await mount({ density: 'touch', onRename: () => {} });
    const row = el.querySelector('[data-testid="session-item"]');
    // 2px of padding around the 28px trailing action box = the header's `h-8`.
    expect(row?.className).toContain('py-0.5');
    // Padding, never a fixed height: a held prompt or a worktree badge adds a
    // line, and `h-8` would clip it.
    expect(row?.className ?? '').not.toMatch(/\bh-8\b/);
  });

  test('a row with nothing to offer draws no menu trigger', async () => {
    const el = await mount();
    expect(el.querySelector('[aria-label="Session actions"]')).toBeNull();
  });
});
