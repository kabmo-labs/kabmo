/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Two facts the surface states about itself: an empty document says so, and a
 * plugin that throws is reported rather than swallowed.
 *
 * Both are wiring, and both fail invisibly — a `placeholder` that never reaches
 * the extension list looks exactly like a file with one blank line, and
 * CodeMirror's own `exceptionSink` default (`console.error`) is indistinguishable
 * from an editor that simply has nothing to draw.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';

import { surfaceExtensions } from '@/client/components/common/code-surface/extensions';
import { SHIKI_THEMES } from '@/shared/lib/code/shiki-themes';
import { EDITOR_ERROR_EVENT, resetEditorErrorReports } from '@/client/lib/editor-errors';
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

/** The component's own stack, with the two options under test. */
function extensionsFor(options: { placeholder?: string; extra?: unknown[] } = {}) {
  return [
    ...surfaceExtensions({
      language: 'typescript',
      wordWrapCompartment: new Compartment(),
      readOnlyCompartment: new Compartment(),
      themeCompartment: new Compartment(),
      languageCompartment: new Compartment(),
      indentCompartment: new Compartment(),
      typingCompartment: new Compartment(),
      blameCompartment: new Compartment(),
      blame: null,
      indentUnitText: '  ',
      typing: { autoCloseBrackets: false, autocomplete: false },
      wordWrap: false,
      readOnly: false,
      themes: SHIKI_THEMES,
      onDocChange: () => {},
      onState: () => {},
      placeholder: options.placeholder,
    }),
    ...(options.extra ?? []),
  ];
}

function mount(doc: string, options: { placeholder?: string; extra?: unknown[] } = {}): EditorView {
  return new EditorView({
    parent: host,
    state: EditorState.create({ doc, extensions: extensionsFor(options) as never }),
  });
}

describe('placeholder', () => {
  test('an empty document draws the sentence', () => {
    const view = mount('', { placeholder: 'This file is empty' });
    const node = view.contentDOM.querySelector('.cm-placeholder');
    expect(node?.textContent).toBe('This file is empty');
    view.destroy();
  });

  test('a document with text draws nothing', () => {
    const view = mount('a\n', { placeholder: 'This file is empty' });
    expect(view.contentDOM.querySelector('.cm-placeholder')).toBeNull();
    view.destroy();
  });

  test('no placeholder configured draws nothing, even when empty', () => {
    // The diff panel mounts the surface with no placeholder: an empty side of a
    // diff is a fact the panel states itself.
    const view = mount('');
    expect(view.contentDOM.querySelector('.cm-placeholder')).toBeNull();
    view.destroy();
  });
});

describe('exceptionSink', () => {
  test('a plugin that throws on construction is reported as an editor error', () => {
    resetEditorErrorReports();
    const seen: string[] = [];
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ message: string }>).detail;
      seen.push(detail.message);
    };
    window.addEventListener(EDITOR_ERROR_EVENT, listener);

    const throwing = ViewPlugin.define(() => {
      throw new Error('viewport plugin exploded');
    });
    // Construction happens on mount, which is where a real plugin fails.
    let view: EditorView | null = null;
    try {
      view = mount('a\n', { extra: [throwing] });
    } catch {
      // CodeMirror may rethrow after reporting; the assertion is the report.
    }
    view?.destroy();
    window.removeEventListener(EDITOR_ERROR_EVENT, listener);

    expect(seen).toContain('viewport plugin exploded');
  });
});
