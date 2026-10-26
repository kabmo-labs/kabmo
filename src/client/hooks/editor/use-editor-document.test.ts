/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the editor PUBLISHES for the Files panel's outline.
 *
 * The `preview` field is not cosmetic: it decides whether the panel is a table of
 * contents (a rendered markdown page, where a row scrolls to a heading and the
 * reader stays) or a symbol outline (the source, where a row moves a caret). A
 * wrong value in either direction produces a list whose every row does the other
 * thing, and nothing on screen says so.
 *
 * The states are pinned together because they are what makes the panel's empty
 * sentences distinguishable — "still reading", "the read failed", "this tab has
 * no outline" and "a diff has none" are four different facts.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useEditorDocument, type EditorDocumentInput } from '@/client/hooks/editor/use-editor-document';
import { getEditorDocument, resetEditorDocument } from '@/client/lib/editor-document';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  resetEditorDocument();
});

afterAll(() => {
  restoreDomGlobals();
});

const FILE = { id: 'docs/notes.md', name: 'notes.md', path: 'docs/notes.md' };

function input(over: Partial<EditorDocumentInput> = {}): EditorDocumentInput {
  return {
    file: FILE,
    content: '# Title\n',
    language: 'markdown',
    loaded: true,
    isLoading: false,
    loadError: null,
    viewerKind: 'markdown',
    isBinaryViewer: false,
    preview: true,
    ...over,
  };
}

async function mount(value: EditorDocumentInput | null): Promise<void> {
  function Probe({ doc }: { doc: EditorDocumentInput | null }) {
    useEditorDocument(doc);
    return h('div', {});
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(Probe, { doc: value }), container);
  });
}

describe('useEditorDocument', () => {
  test('a rendered markdown page publishes preview, so the panel is a contents list', async () => {
    await mount(input());

    expect(getEditorDocument()).toMatchObject({ path: 'docs/notes.md', state: 'ready', preview: true });
  });

  test('the same file in SOURCE mode publishes no preview', async () => {
    await mount(input({ preview: false }));

    expect(getEditorDocument()).toMatchObject({ state: 'ready', preview: false });
  });

  test('a rendered CSV or SVG is NOT a contents list', async () => {
    // Rendered, but its rows are not headings — a contents entry there could
    // only be served by leaving the preview, which is the wrong promise.
    await mount(input({ viewerKind: 'csv', file: { id: 'a.csv', name: 'a.csv', path: 'a.csv' } }));
    expect(getEditorDocument().preview).toBe(false);
  });

  test('no state that cannot be read publishes a preview', async () => {
    await mount(input({ loaded: false, isLoading: true }));
    expect(getEditorDocument()).toMatchObject({ state: 'loading', preview: false });

    await mount(input({ loadError: 'EACCES' }));
    expect(getEditorDocument()).toMatchObject({ state: 'error', preview: false });

    await mount(input({ isBinaryViewer: true, viewerKind: 'pdf', file: { id: 'a.pdf', name: 'a.pdf', path: 'a.pdf' } }));
    expect(getEditorDocument()).toMatchObject({ state: 'not-a-document', preview: false });

    await mount(input({ file: { ...FILE, isDiff: true } }));
    expect(getEditorDocument()).toMatchObject({ state: 'diff', preview: false });
  });

  test('a null input publishes nothing at all', async () => {
    await mount(null);

    // The phone's editor passes null: it draws its own outline and must not
    // claim (or blank) the slot the desktop owns.
    expect(getEditorDocument().state).toBe('idle');
  });
});
