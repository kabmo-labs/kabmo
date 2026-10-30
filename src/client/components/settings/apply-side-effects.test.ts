/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `applySettingsSideEffects`: announce what MOVED, and nothing else.
 *
 * The modal used to inline this chain, and two properties of it are invisible
 * until broken:
 *
 * - **an unrelated edit announces nothing** — a re-render caused by, say, the
 *   goal model must not churn every editor's font stack or every timeline's
 *   renderer;
 * - **the sidebar style is announced**, because the sidebar is visible BEHIND
 *   the settings modal — it is the one setting whose effect the user watches
 *   happen, and a missing announcement means the column keeps the old chrome
 *   until a reload.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { applySettingsSideEffects } from '@/client/components/settings/apply-side-effects';
import { DEFAULT_SETTINGS } from '@/shared/lib/settings/defaults';
import { SIDEBAR_STYLE_CHANGED_EVENT } from '@/client/hooks/workspace/sidebar-style';
import { EDITOR_FONT_CHANGED_EVENT } from '@/client/hooks/editor/font';
import type { SettingsState } from '@/shared/types';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalCustomEvent = globalThis.CustomEvent;

/**
 * The side effects construct `CustomEvent`s, and happy-dom's `dispatchEvent`
 * rejects an event from another realm — so the DOM installed here brings its
 * own `CustomEvent` with it rather than reusing the runner's.
 */
function installDom() {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  target.window = win;
  target.document = win.document;
  target.CustomEvent = (win as unknown as Record<string, unknown>).CustomEvent;
  return win;
}

afterEach(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  target.window = originalWindow;
  target.document = originalDocument;
  target.CustomEvent = originalCustomEvent;
});

function state(overrides: Partial<SettingsState> = {}): SettingsState {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe('applySettingsSideEffects', () => {
  test('announces the sidebar style so the column behind the modal redraws', () => {
    const win = installDom();
    const seen: unknown[] = [];
    win.addEventListener(SIDEBAR_STYLE_CHANGED_EVENT, (event) => seen.push((event as unknown as CustomEvent).detail));

    applySettingsSideEffects(state(), state({ sidebarStyle: 'modern' }));

    expect(seen).toEqual(['modern']);
  });

  test('does not announce a style that did not move', () => {
    const win = installDom();
    const seen: unknown[] = [];
    win.addEventListener(SIDEBAR_STYLE_CHANGED_EVENT, (event) => seen.push((event as unknown as CustomEvent).detail));

    applySettingsSideEffects(state({ sidebarStyle: 'modern' }), state({ sidebarStyle: 'modern' }));

    expect(seen).toEqual([]);
  });

  test('an unrelated edit announces nothing at all', () => {
    const win = installDom();
    const events: string[] = [];
    for (const name of [SIDEBAR_STYLE_CHANGED_EVENT, EDITOR_FONT_CHANGED_EVENT]) {
      win.addEventListener(name, () => events.push(name));
    }

    applySettingsSideEffects(state(), state({ goalDefaultBudget: 5000 }));

    expect(events).toEqual([]);
  });

  test('the editor font still announces when it moves', () => {
    const win = installDom();
    const seen: unknown[] = [];
    win.addEventListener(EDITOR_FONT_CHANGED_EVENT, (event) => seen.push((event as unknown as CustomEvent).detail));

    // Any family that is not the shipped default, or the value has not moved
    // and nothing is announced.
    applySettingsSideEffects(state(), state({ editorFont: 'JetBrains Mono' }));

    expect(seen).toEqual(['JetBrains Mono']);
  });
});
