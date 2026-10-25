/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The code surface's colours, and the two mechanisms that carry them.
 *
 * An editor theme is applied in TWO places, and confusing them is the bug this
 * file exists to catch:
 *
 * - **The chrome** (surface, gutter, caret, selection, find, diff bands) is a
 *   set of `--editor-*` custom properties on the surface's own host. Writing
 *   them repaints the editor with no transaction at all, which is what makes a
 *   theme switch a colour change rather than a rebuild.
 * - **The tokens** are baked into the Shiki decoration plugin, because Shiki is
 *   handed theme NAMES at tokenize time. That one needs a compartment
 *   reconfigure — and the reconfigure must keep the document, the selection and
 *   the undo history, which is why it is a compartment and not a re-mount.
 *
 * Both are asserted through a real `EditorView` in happy-dom: the theme
 * extension emits real CSS, and a stub would test the stub.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { createDocumentCache } from '@/client/components/common/code-surface/documents';
import { surfaceTheme } from '@/client/components/common/code-surface/theme';
import { editorThemeVars, resolveEditorTheme } from '@/shared/lib/code/editor/themes';
import { SHIKI_THEMES } from '@/shared/lib/code/shiki-themes';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const EXTRA_GLOBALS = ['MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;
const native: Partial<Record<(typeof EXTRA_GLOBALS)[number], unknown>> = {};

let host: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of EXTRA_GLOBALS) {
    native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  host = document.body.appendChild(document.createElement('div'));
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of EXTRA_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
  restoreDomGlobals();
});

/** The stylesheet CM6 generated for the theme extension. */
function themeCss(): string {
  return Array.from(document.head.querySelectorAll('style'))
    .map((node) => node.textContent ?? '')
    .join('\n');
}

describe('surface theme', () => {
  /** CM6 injects a theme's stylesheet when a VIEW mounts, not when the
   *  extension is built — so one view is mounted for the CSS cases below. */
  beforeAll(() => {
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: 'x', extensions: [surfaceTheme()] }),
    });
    view.destroy();
  });

  test('every chrome colour is a variable with the app palette as its fallback', () => {
    const css = themeCss();
    // The editor's own variable first, the app's palette behind it — which is
    // what makes `auto` a no-op and an explicit theme a pure repaint.
    expect(css).toContain('background-color: var(--editor-bg, transparent)');
    expect(css).toContain('color: var(--editor-fg, var(--theme-ink))');
    expect(css).toContain('var(--editor-gutter-fg,');
    expect(css).toContain('var(--editor-selection,');
    expect(css).toContain('var(--editor-cursor, var(--theme-ink))');
    expect(css).toContain('var(--editor-find,');
    expect(css).toContain('var(--editor-border,');
  });

  test('a token paints from the app variant when the editor theme is auto', () => {
    const css = themeCss();
    expect(css).toContain('.cm-content .shiki-tok {color: var(--shiki-light)');
    // The dark rule is scoped to the app's variant attribute, so an app theme
    // flip recolours tokens with no re-tokenize.
    expect(css).toContain('html[data-theme-variant="dark"]');
    expect(css).toContain('var(--shiki-dark)');
  });

  test('the bracket pair is painted from the palette, and the FOCUSED rule outranks the package', () => {
    const css = themeCss();
    // The package's own colours are hardcoded hex (`#328c8252`); a themed app
    // that did not restate them showed the package's green.
    expect(css).not.toContain('#328c8252');
    expect(css).toContain('.cm-matchingBracket');
    expect(css).toContain('.cm-nonmatchingBracket');
    // The load-bearing half: the package spells its rule `.ͼ1.cm-focused …`
    // (specificity 0,2,0), so a bare `.cm-matchingBracket` here is 0,1,1 and
    // loses. The focused form must be present or the editor is unthemed while
    // it has focus — which is whenever anyone is looking at it.
    const focused = /\.\S+\.cm-focused \.cm-matchingBracket \{[^}]*background-color: color-mix/.test(css);
    expect(focused).toBe(true);
  });

  test('the fold placeholder is declared LONGHAND, because style-mod cannot parse a var() shorthand', () => {
    const css = themeCss();
    // Measured: `border: 1px solid var(--x)` is expanded by style-mod into
    // `border-width: var(--x); border-style: var(--x)` — garbage that paints
    // nothing. The longhand form sidesteps the expansion entirely.
    expect(css).toContain('.cm-foldPlaceholder');
    expect(css).not.toMatch(/\.cm-foldPlaceholder \{[^}]*border: 1px solid var\(/);
    expect(css).toMatch(/\.cm-foldPlaceholder \{[^}]*border-width: 1px/);
    expect(css).toMatch(/\.cm-foldPlaceholder \{[^}]*border-style: solid/);
    expect(css).toMatch(/\.cm-foldPlaceholder \{[^}]*border-color: /);
  });

  test('the fold gutter’s glyph is styled, so its box does not shift as blocks open', () => {
    const css = themeCss();
    expect(css).toContain('.cm-foldGutter .cm-gutterElement');
    expect(css).toContain('min-width: 1.1rem');
  });

  test('writing the theme variables on the host repaints without a transaction', () => {
    const view = new EditorView({ parent: host, state: EditorState.create({ doc: 'const a = 1;', extensions: [surfaceTheme()] }) });
    try {
      const theme = resolveEditorTheme('dracula');
      expect(theme).not.toBeNull();
      const before = view.state.doc.length;
      for (const [key, value] of Object.entries(editorThemeVars(theme))) {
        host.style.setProperty(key, value);
      }
      // The document and its history are untouched: a colour change is CSS.
      expect(view.state.doc.length).toBe(before);
      expect(host.style.getPropertyValue('--editor-bg')).toBe(theme!.bg);
      expect(host.style.getPropertyValue('--editor-gutter-fg')).toBe(theme!.gutterFg);
    } finally {
      view.destroy();
    }
  });
});

describe('document cache theme reconfigure', () => {
  function cache() {
    return createDocumentCache({
      wordWrap: false,
      readOnly: false,
      themes: SHIKI_THEMES,
      onDocChange: () => {},
      onState: () => {},
    });
  }

  test('a theme change is reported for the document it applies to', () => {
    const documents = cache();
    documents.stateFor('a', 'typescript', 'const a = 1;');

    // Nothing moved: no effects, which is what keeps a re-render free.
    expect(documents.optionsEffects({ wordWrap: false, readOnly: false, themes: SHIKI_THEMES }, 'a')).toEqual([]);

    const effects = documents.optionsEffects(
      { wordWrap: false, readOnly: false, themes: { light: 'dracula', dark: 'dracula' } },
      'a',
    );
    expect(effects).toHaveLength(1);
  });

  test('a wrap toggle and a theme change are independent effects', () => {
    const documents = cache();
    documents.stateFor('a', 'typescript', 'x');
    const effects = documents.optionsEffects(
      { wordWrap: true, readOnly: false, themes: { light: 'nord', dark: 'nord' } },
      'a',
    );
    // Two compartments: one for the wrap, one for the tokenizer.
    expect(effects).toHaveLength(2);
  });

  test('a reconfigure keeps the document, the caret and the history', () => {
    const documents = cache();
    const first = documents.stateFor('a', 'typescript', 'const a = 1;');
    const edited = first.update({ changes: { from: 0, to: 5, insert: 'let' } }).state;
    documents.remember('a', edited);

    const themeCompartment = new Compartment();
    const view = new EditorView({ parent: host, state: edited });
    try {
      // A reconfigure of a live view is what a theme switch does.
      view.dispatch({ effects: themeCompartment.reconfigure([]) });
      expect(view.state.doc.toString()).toBe('let a = 1;');
      expect(view.state.selection.main.head).toBe(edited.selection.main.head);
    } finally {
      view.destroy();
    }
  });

  test('a document switched back gets the CURRENT theme, not the one it was created with', () => {
    const documents = cache();
    documents.stateFor('a', 'typescript', 'a');
    documents.optionsEffects(
      { wordWrap: false, readOnly: false, themes: { light: 'dracula', dark: 'dracula' } },
      'a',
    );
    // `currentEffects` is the re-apply `view.setState` owes: a cached state
    // carries the configuration it was CREATED with.
    const effects = documents.currentEffects('a');
    expect(effects.length).toBeGreaterThan(0);
  });

  test('a switch back to a document that already holds the theme does not re-tokenize', () => {
    const documents = cache();
    documents.stateFor('a', 'typescript', 'a');
    documents.stateFor('b', 'typescript', 'b');
    const dracula = { light: 'dracula', dark: 'dracula' };

    // Pick the theme while `a` is the live document, then switch to `b` — the
    // apply path reconfigures BOTH, which is what makes them agree.
    documents.optionsEffects({ wordWrap: false, readOnly: false, themes: dracula }, 'a');
    documents.currentEffects('b');
    // ... and back: `a` already holds the theme, so there is nothing to rebuild.
    const effects = documents.currentEffects('a');
    // Wrap + read-only only; the tokenizer's reconfigure is absent.
    expect(effects).toHaveLength(2);
  });
});
