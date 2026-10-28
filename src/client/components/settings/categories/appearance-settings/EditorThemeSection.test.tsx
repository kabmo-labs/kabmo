/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor theme picker.
 *
 * Three properties are invisible to a markup check and each is a bug if dropped:
 *
 * - **`Auto` is a card and is selected by default**, so an install that never
 *   touches this section renders exactly what it did before the feature.
 * - **The swatch is drawn from the row's own colours**, not from the app
 *   palette: a card that previewed every theme in the app's ink would make 65
 *   themes look identical, which is the whole point of the grid.
 * - **A click writes the theme id through `onUpdate`**, which is what the modal
 *   turns into the event an already-open editor subscribes to.
 *
 * Rendered with `h()` against happy-dom; the modal's write path is pinned in
 * `settings/Modal`'s own suite.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { EditorThemeSection } from '@/client/components/settings/categories/appearance-settings/EditorThemeSection';
import { EDITOR_AUTO_THEME_ID, EDITOR_THEMES, resolveEditorTheme } from '@/shared/lib/code/editor/themes';
import { EDITOR_DEFAULT_FONT_FAMILY } from '@/shared/lib/code/editor/typography';
import type { SettingsState } from '@/shared/types';

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent',
  'getComputedStyle',
] as const;

const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    const value = (win as unknown as Record<string, unknown>)[key];
    if (value !== undefined) target[key] = value;
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
});

let container: HTMLElement | null = null;
type Update = Partial<SettingsState> | ((prev: SettingsState) => SettingsState);
let lastUpdate: Update | null = null;

/** Reset through a function: assigning `null` inline would narrow the variable
 *  at every later read, and the assertions below exist to see the VALUE. */
function resetUpdate(): void {
  lastUpdate = null;
}

/** What the last click asked to persist, as a value the assertions can read. */
function lastPatch(): unknown {
  return lastUpdate;
}

function settings(editorTheme: string): SettingsState {
  return { editorTheme, editorFont: EDITOR_DEFAULT_FONT_FAMILY } as SettingsState;
}

async function mount(editorTheme: string): Promise<HTMLElement> {
  if (container) render(null, container);
  container = document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(
      h(EditorThemeSection, {
        settings: settings(editorTheme),
        onUpdate: (update: Update) => {
          lastUpdate = update;
        },
      }),
      container!,
    );
  });
  return container;
}

/** The card whose label starts with `label` (the label is the first text). */
function card(root: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll('button')).find((button) =>
    (button.textContent ?? '').trim().startsWith(label),
  );
}

describe('editor theme picker', () => {
  test('Auto is a card, and it is the selected one by default', async () => {
    const root = await mount(EDITOR_AUTO_THEME_ID);
    const auto = card(root, 'Auto');
    expect(auto).toBeDefined();
    expect(auto!.getAttribute('aria-pressed')).toBe('true');
    // Every shipped theme is offered beside it, so the grid is not a two-item
    // list with the catalogue hidden behind a filter.
    expect(root.querySelectorAll('button[aria-pressed]').length).toBe(EDITOR_THEMES.length + 1);
  });

  test('a stored theme is the selected card, and Auto is not', async () => {
    const root = await mount('dracula');
    expect(card(root, 'Dracula Theme')!.getAttribute('aria-pressed')).toBe('true');
    expect(card(root, 'Auto')!.getAttribute('aria-pressed')).toBe('false');
  });

  test('the swatch is drawn in the theme’s OWN colours', async () => {
    const root = await mount('dracula');
    const theme = resolveEditorTheme('dracula');
    expect(theme).not.toBeNull();
    const swatch = Array.from(card(root, 'Dracula Theme')!.querySelectorAll('span')).find(
      (node) => (node as HTMLElement).style.backgroundColor !== '',
    ) as HTMLElement | undefined;
    expect(swatch).toBeDefined();
    // The card paints the theme's own surface, not the app's — which is what
    // makes 65 themes distinguishable in one grid.
    expect(swatch!.style.backgroundColor.toLowerCase()).toBe(theme!.bg.toLowerCase());
  });

  test('a click writes the theme id', async () => {
    resetUpdate();
    const root = await mount(EDITOR_AUTO_THEME_ID);
    await act(async () => {
      card(root, 'Nord')!.click();
    });
    expect(lastPatch()).toEqual({ editorTheme: 'nord' });
  });

  test('the Auto card writes the sentinel, not an empty string', async () => {
    resetUpdate();
    const root = await mount('nord');
    await act(async () => {
      card(root, 'Auto')!.click();
    });
    // An empty value would resolve to `auto` too, but it would also be a value
    // no reader can distinguish from a missing setting.
    expect(lastPatch()).toEqual({ editorTheme: EDITOR_AUTO_THEME_ID });
  });

  test('the light/dark filters narrow the grid without dropping Auto', async () => {
    const root = await mount(EDITOR_AUTO_THEME_ID);
    const darkFilter = Array.from(root.querySelectorAll('button')).find(
      (button) => (button.textContent ?? '').trim() === 'Dark',
    );
    await act(async () => {
      darkFilter!.click();
    });
    const labels = Array.from(root.querySelectorAll('button[aria-pressed]')).map((button) =>
      (button.textContent ?? '').trim().split(/\d/)[0],
    );
    expect(labels.length).toBe(EDITOR_THEMES.filter((theme) => theme.variant === 'dark').length + 1);
    expect(labels.some((label) => label.startsWith('GitHub Light'))).toBe(false);
    // Auto is a choice, not a light/dark theme, so a variant filter keeps it.
    expect(labels.some((label) => label.startsWith('Auto'))).toBe(true);
  });
});
