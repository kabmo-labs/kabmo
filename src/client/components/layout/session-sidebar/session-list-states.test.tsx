/**
 * The session list's three states, which used to be two.
 *
 * The failure this guards was measured on the running app: with `/api/**`
 * aborted, the drawer kept drawing placeholders after seven seconds, with no
 * text, no `role="alert"` and no retry — a failed read was indistinguishable
 * from a slow one, forever. The suite drives the two shared chromes (desktop
 * `classic` and the phone drawer's `classic`) and asserts the third state names
 * the cause AND offers the action.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';

import { SessionListNotice } from '@/client/components/layout/session-sidebar/SessionListNotice';
import { ClassicSidebarView } from '@/client/components/layout/session-sidebar/ClassicView';
import { ClassicDrawer } from '@/client/components/mobile/mobile-session-sidebar/ClassicDrawer';

const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

afterEach(() => {
  render(null, container);
});

/** Every prop the chrome needs, with the state under test in it. */
function props(overrides: Record<string, unknown> = {}) {
  return {
    folders: [],
    initializing: false,
    failed: false,
    activeSessionId: null,
    sessionStatus: {},
    searchQuery: '',
    onSearchChange: () => {},
    showArchived: false,
    onToggleArchived: () => {},
    sortOption: 'LATEST_SESSION' as const,
    optionsOpen: false,
    onToggleOptions: () => {},
    onCloseOptions: () => {},
    onSortChange: () => {},
    onRefresh: () => {},
    refreshing: false,
    scheduledCount: 0,
    onNewSession: () => {},
    onNewWorkspace: () => {},
    onScheduler: () => {},
    onSelectSession: () => {},
    onNewSessionForFolder: () => {},
    onToast: () => {},
    onSelectWorkspaces: () => {},
    onStartSessionSelection: () => {},
    ...overrides,
  };
}

describe('SessionListNotice', () => {
  test('names the cause, states the data still exists, and offers the retry', () => {
    let retried = 0;
    render(h(SessionListNotice, { onRetry: () => { retried += 1; } }), container);

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain('could not be loaded');
    // The cause, not just the symptom: a closed connection is why nothing came.
    expect(alert!.textContent).toContain('connection closed');
    // It must not claim the sessions are gone, because they are not.
    expect(alert!.textContent).toContain('still on disk');

    const button = container.querySelector('button')!;
    expect(button.textContent).toContain('Try again');
    button.click();
    expect(retried).toBe(1);
  });

  test('the phone variant keeps a 44px target', () => {
    render(h(SessionListNotice, { touch: true, onRetry: () => {} }), container);
    expect(container.querySelector('button')!.className).toContain('h-11');
  });
});

describe('ClassicSidebarView states', () => {
  test('failed draws the notice instead of the skeleton', () => {
    render(h(ClassicSidebarView, props({ failed: true })), container);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('[aria-hidden="true"].space-y-4')).toBeNull();
  });

  test('initializing still draws the skeleton, because a reply is still coming', () => {
    render(h(ClassicSidebarView, props({ initializing: true })), container);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  test('loaded and empty says why it is empty rather than failing', () => {
    render(h(ClassicSidebarView, props()), container);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('No workspaces available.');
  });
});

describe('ClassicDrawer states', () => {
  const base = {
    expandedFolders: {},
    onToggleFolder: () => {},
    onResetSort: () => {},
    onHideArchived: () => {},
    onClearSearch: () => {},
    selecting: false,
    optionsRef: { current: null },
  };

  test('failed draws the notice with the phone target size', () => {
    render(h(ClassicDrawer, { ...props({ failed: true }), ...base } as never), container);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"] button')!.className).toContain('h-11');
  });
});
