/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The git-plugin freshness row and the toolbar's switch.
 *
 * Four states the row must tell apart, and the failure each one hides: a plugin
 * whose remote was never asked must not read as current, a probe that FAILED must
 * not read as current either, and only a real behind-by-a-commit answer may
 * offer Update. Collapsing them into one badge is the bug this pins.
 *
 * The toolbar's switch is a `role="checkbox"` whose `aria-checked` mirrors the
 * server's value — a switch that rendered its own optimistic state would pass a
 * visual check while disagreeing with the flag the background pass reads.
 *
 * Rendered with `h()` against happy-dom, following the panel suites.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { GitFreshness } from '@/client/components/settings/categories/panel-plugins/GitFreshness';
import { PluginToolbar } from '@/client/components/settings/categories/panel-plugins/Toolbar';
import { SyncBlockedNotice } from '@/client/components/settings/categories/panel-plugins/SyncBlockedNotice';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
});

afterAll(() => {
  restoreDomGlobals();
});

/** Mount one element and return the container. */
function mount(node: h.JSX.Element): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  act(() => render(node, container));
  return container;
}

const STATUS_BASE = { checkedAt: 1_700_000_000_000 };

describe('GitFreshness', () => {
  test('a never-probed plugin says so instead of reading as current', () => {
    const el = mount(
      h(GitFreshness, { status: undefined, origin: 'https://x/y.git', busy: null, pluginId: 'demo', onUpdate: async () => true }),
    );
    expect(el.textContent).toContain('not checked');
    expect(el.textContent).not.toContain('up to date');
  });

  test('a failed probe names the reason and offers no Update', () => {
    const el = mount(
      h(GitFreshness, {
        status: { ...STATUS_BASE, current: 'a1b2c3d4e5', latest: null, updateAvailable: false, error: 'the remote did not answer in time' },
        origin: 'https://x/y.git',
        busy: null,
        pluginId: 'demo',
        onUpdate: async () => true,
      }),
    );
    expect(el.textContent).toContain('could not reach');
    expect(el.textContent).not.toContain('up to date');
    expect(el.querySelector('button')).toBeNull();
  });

  test('an up-to-date plugin shows its short commit and no button', () => {
    const el = mount(
      h(GitFreshness, {
        status: { ...STATUS_BASE, current: 'a1b2c3d4e5f6', latest: 'a1b2c3d4e5f6', updateAvailable: false },
        origin: 'https://x/y.git',
        busy: null,
        pluginId: 'demo',
        onUpdate: async () => true,
      }),
    );
    // Seven characters, the abbreviation git itself prints.
    expect(el.textContent).toContain('a1b2c3d');
    expect(el.textContent).not.toContain('a1b2c3d4e5f6');
    expect(el.textContent).toContain('up to date');
  });

  test('a behind plugin shows both commits and offers Update', () => {
    const el = mount(
      h(GitFreshness, {
        status: { ...STATUS_BASE, current: 'a1b2c3d4e5f6', latest: '9f8e7d6c5b4a', updateAvailable: true },
        origin: 'https://x/y.git',
        busy: null,
        pluginId: 'demo',
        onUpdate: async () => true,
      }),
    );
    expect(el.textContent).toContain('a1b2c3d');
    expect(el.textContent).toContain('9f8e7d6');
    const button = el.querySelector('button');
    expect(button?.textContent).toContain('Update');
    expect(button?.getAttribute('title')).toContain('https://x/y.git');
  });

  test('Update is disabled while any action is in flight', () => {
    const el = mount(
      h(GitFreshness, {
        status: { ...STATUS_BASE, current: 'a1b2c3d4e5f6', latest: '9f8e7d6c5b4a', updateAvailable: true },
        origin: 'https://x/y.git',
        busy: 'remove:other',
        pluginId: 'demo',
        onUpdate: async () => true,
      }),
    );
    expect(el.querySelector('button')?.hasAttribute('disabled')).toBe(true);
  });
});

describe('PluginToolbar', () => {
  test('the switch mirrors the server value, both ways', () => {
    const off = mount(
      h(PluginToolbar, {
        autoUpdate: false,
        busy: null,
        gitCount: 1,
        onSetAutoUpdate: async () => true,
        onCheckUpdates: async () => true,
        onRefresh: () => {},
      }),
    );
    const checkboxOff = off.querySelector('[role="checkbox"]');
    expect(checkboxOff?.getAttribute('aria-checked')).toBe('false');
    expect(off.textContent).toContain('Off — updates are applied only when you press Update.');

    render(null, container);
    const on = mount(
      h(PluginToolbar, {
        autoUpdate: true,
        busy: null,
        gitCount: 1,
        onSetAutoUpdate: async () => true,
        onCheckUpdates: async () => true,
        onRefresh: () => {},
      }),
    );
    expect(on.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true');
    // The consequence is stated, not implied: the pass hard-resets a clone.
    expect(on.textContent).toContain('with no confirmation');
  });

  test('the check is disabled with nothing to check', () => {
    const el = mount(
      h(PluginToolbar, {
        autoUpdate: false,
        busy: null,
        gitCount: 0,
        onSetAutoUpdate: async () => true,
        onCheckUpdates: async () => true,
        onRefresh: () => {},
      }),
    );
    const buttons = Array.from(el.querySelectorAll('button'));
    const check = buttons.find((button) => button.textContent?.includes('Check for updates'));
    expect(check?.hasAttribute('disabled')).toBe(true);
    expect(check?.getAttribute('title')).toContain('No git-installed plugins');
  });
});

describe('SyncBlockedNotice', () => {
  test('renders nothing when no plugin is blocked', () => {
    const el = mount(h(SyncBlockedNotice, { blocked: {}, busy: null, onForceSync: async () => true }));
    expect(el.textContent).toBe('');
    expect(el.querySelector('button')).toBeNull();
  });

  test('names the changed files, and summarises the rest', () => {
    const changed = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts'];
    const el = mount(h(SyncBlockedNotice, { blocked: { demo: { at: 1, changed } }, busy: null, onForceSync: async () => true }));

    expect(el.textContent).toContain('demo');
    // The count is the fact a user acts on, and the first few paths make it
    // concrete without printing a whole diff.
    expect(el.textContent).toContain('7 of its files');
    expect(el.textContent).toContain('a.ts');
    expect(el.textContent).toContain('… and 2 more');
    // The wording must read as a refusal, not a failure: the files were left
    // alone, which is what the user wanted unless the edit was a mistake.
    expect(el.textContent).toContain('left as they are');
  });

  test('the override says what it destroys', () => {
    const el = mount(
      h(SyncBlockedNotice, {
        blocked: { demo: { at: 1, changed: ['src/a.ts'] } },
        busy: null,
        onForceSync: async () => true,
      }),
    );
    const button = el.querySelector('button');
    expect(button?.textContent).toContain("Replace my changes with the store's copy");
    expect(button?.getAttribute('title')).toContain('your edits are lost');
    expect(el.textContent).toContain('discards the files listed above');
  });

  test('the override is disabled while another action runs', () => {
    const el = mount(
      h(SyncBlockedNotice, {
        blocked: { demo: { at: 1, changed: ['src/a.ts'] } },
        busy: 'remove:other',
        onForceSync: async () => true,
      }),
    );
    expect(el.querySelector('button')?.hasAttribute('disabled')).toBe(true);
  });

  test('one blocked plugin renders one row', () => {
    const el = mount(
      h(SyncBlockedNotice, {
        blocked: { one: { at: 1, changed: ['a'] }, two: { at: 2, changed: ['b'] } },
        busy: null,
        onForceSync: async () => true,
      }),
    );
    expect(el.querySelectorAll('button')).toHaveLength(2);
  });
});
