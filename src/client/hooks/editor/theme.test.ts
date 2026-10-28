/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor-theme setting, and the two rules that make it safe to offer.
 *
 * A theme is a MODULE that is fetched on selection, so there are two failure
 * modes a unit test can pin without a browser:
 *
 * 1. **The module has to be registered before Shiki can tokenize with it.**
 *    `loadTheme` is idempotent, and a second surface selecting the same theme
 *    must share the first fetch rather than start a second one.
 * 2. **`auto` must not register anything**, and an id this build does not ship
 *    must resolve to no theme rather than leave the editor half-painted.
 *
 * Driven through happy-dom because the hook subscribes to a window event — the
 * same shape the editor FONT uses, and the reason an already-open editor hears
 * about a change at all (`appSettings` is a boot-time prop).
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import {
  EDITOR_THEME_CHANGED_EVENT,
  currentEditorThemeId,
  useEditorTheme,
} from '@/client/hooks/editor/theme';
import {
  isEditorThemeReady,
  loadEditorTheme,
  onEditorThemeReady,
  resetEditorThemeLoader,
} from '@/shared/lib/code/editor/theme-loader';
import { EDITOR_AUTO_THEME_ID, resolveEditorTheme } from '@/shared/lib/code/editor/themes';
import { bootSyntax, onLanguageReady, requestLanguage } from '@/shared/lib/code/highlighter';
import { primeKabmoSettings } from '@/shared/lib/settings/client';

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent',
  'getComputedStyle', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame',
] as const;

/** The runner's own globals, put back once this file's DOM work is done. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

/** happy-dom's `CustomEvent`, so a dispatch is an instance its EventTarget accepts. */
let Custom: typeof CustomEvent;

async function bootTokenizer(): Promise<void> {
  // The highlighter only boots where `window` exists, and the Bun runner has
  // none. Stub it for the boot alone, then hand the global to happy-dom — a
  // `window` left pointing at `globalThis` would make the hook's
  // `dispatchEvent` the runner's, which rejects a happy-dom CustomEvent.
  const target = globalThis as unknown as Record<string, unknown>;
  const had = 'window' in target ? target.window : undefined;
  target.window = globalThis;
  await bootSyntax();
  if (had === undefined) delete target.window;
  else target.window = had;
  const { promise, resolve } = Promise.withResolvers<void>();
  const settle = () => {
    if (requestLanguage('typescript')) {
      off();
      resolve();
    }
  };
  const off = onLanguageReady(settle);
  settle();
  await promise;
}

beforeAll(async () => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    const value = (win as unknown as Record<string, unknown>)[key];
    if (value !== undefined) target[key] = value;
  }
  Custom = win.CustomEvent as unknown as typeof CustomEvent;
  await bootTokenizer();
  resetEditorThemeLoader();
});

afterEach(() => {
  primeKabmoSettings({});
  document.body.innerHTML = '';
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
});

/** A probe that renders exactly what the hook says the surface should paint. */
function ThemeProbe() {
  const theme = useEditorTheme();
  return h(
    'div',
    { id: 'probe' },
    `${theme.theme?.id ?? 'auto'}|${theme.vars['--editor-bg'] ?? 'none'}|${theme.themes.light}`,
  );
}

async function mountProbe(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    render(h(ThemeProbe, {}), host);
  });
  return host.querySelector('#probe') as HTMLElement;
}

describe('currentEditorThemeId', () => {
  test('reads the stored value and falls back to auto', () => {
    primeKabmoSettings({});
    expect(currentEditorThemeId()).toBe(EDITOR_AUTO_THEME_ID);

    primeKabmoSettings({ kabmo_settings: { editorTheme: 'nord' } });
    expect(currentEditorThemeId()).toBe('nord');
  });
});

describe('theme module loading', () => {
  test('auto needs no module, and an unknown id is a no-op', async () => {
    resetEditorThemeLoader();
    await loadEditorTheme(EDITOR_AUTO_THEME_ID);
    expect(isEditorThemeReady(EDITOR_AUTO_THEME_ID)).toBe(true);

    await loadEditorTheme('no-such-theme');
    expect(isEditorThemeReady('no-such-theme')).toBe(false);
  });

  test('a shipped theme registers with the highlighter and announces itself', async () => {
    resetEditorThemeLoader();
    const seen: string[] = [];
    const off = onEditorThemeReady((id) => seen.push(id));
    try {
      expect(isEditorThemeReady('nord')).toBe(false);
      await loadEditorTheme('nord');
      expect(isEditorThemeReady('nord')).toBe(true);
      expect(seen).toEqual(['nord']);
    } finally {
      off();
    }
  });

  test('two requests for one theme share a single registration', async () => {
    resetEditorThemeLoader();
    let announcements = 0;
    const off = onEditorThemeReady(() => announcements++);
    try {
      await Promise.all([loadEditorTheme('dracula'), loadEditorTheme('dracula')]);
      expect(announcements).toBe(1);
      // Already registered: a third call resolves without announcing again.
      await loadEditorTheme('dracula');
      expect(announcements).toBe(1);
    } finally {
      off();
    }
  });
});

describe('useEditorTheme', () => {
  test('auto renders no variables and the app’s dual pair', async () => {
    primeKabmoSettings({});
    const probe = await mountProbe();
    expect(probe.textContent).toBe('auto|none|one-light');
  });

  test('an explicit theme renders its own surface and names itself in both slots', async () => {
    primeKabmoSettings({ kabmo_settings: { editorTheme: 'dracula' } });
    const probe = await mountProbe();
    const theme = resolveEditorTheme('dracula');
    expect(theme).not.toBeNull();
    expect(probe.textContent).toBe(`dracula|${theme!.bg}|dracula`);
  });

  test('a write reaches an ALREADY-MOUNTED editor without a reload', async () => {
    primeKabmoSettings({});
    const probe = await mountProbe();
    expect(probe.textContent).toBe('auto|none|one-light');

    // Exactly what the settings modal dispatches on a change.
    await act(async () => {
      window.dispatchEvent(new Custom(EDITOR_THEME_CHANGED_EVENT, { detail: 'nord' }));
    });
    const nord = resolveEditorTheme('nord');
    expect(probe.textContent).toBe(`nord|${nord!.bg}|nord`);

    // And back to auto, which must clear the variables again rather than leave
    // the previous theme's surface behind.
    await act(async () => {
      window.dispatchEvent(new Custom(EDITOR_THEME_CHANGED_EVENT, { detail: EDITOR_AUTO_THEME_ID }));
    });
    expect(probe.textContent).toBe('auto|none|one-light');
  });
});
