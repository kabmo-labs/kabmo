/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The per-document state cache.
 *
 * The property worth pinning is the one the old single-buffer surface could not
 * offer: a tab's caret, its extra cursors and its undo history belong to THAT
 * tab. A cache that handed back a fresh state per call would pass a "the text is
 * right" test and still lose every undo step, so these assert history and
 * selection, not just the document.
 *
 * Driven through `EditorState` alone — `undo` is a `StateCommand`, so it takes
 * `{ state, dispatch }` and needs no view, no DOM and no geometry. That is the
 * whole reason the cache is a separate module: it is testable without a browser.
 */

import { describe, expect, test } from 'bun:test';
import { EditorSelection } from '@codemirror/state';
import { undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';

import { createDocumentCache } from '@/client/components/common/code-surface/documents';
import { SHIKI_THEMES } from '@/shared/lib/code/shiki-themes';

function cache(overrides: Partial<Parameters<typeof createDocumentCache>[0]> = {}) {
  return createDocumentCache({
    wordWrap: false,
    readOnly: false,
    themes: SHIKI_THEMES,
    onDocChange: () => {},
    onState: () => {},
    ...overrides,
  });
}

/** Apply `undo` to a state the way a `Command` would, returning the new state. */
function undoOnce(state: ReturnType<ReturnType<typeof cache>['stateFor']>) {
  let next = state;
  undo({ state, dispatch: (transaction) => { next = transaction.state; } });
  return next;
}

describe('document cache', () => {
  test('an edit in one document cannot be undone from another', () => {
    const documents = cache();
    const first = documents.stateFor('a', 'typescript', 'const a = 1;');
    const second = documents.stateFor('b', 'typescript', 'const b = 2;');

    const editedFirst = first.update({ changes: { from: 0, to: 5, insert: 'let' } }).state;
    const editedSecond = second.update({ changes: { from: 0, to: 5, insert: 'let' } }).state;
    documents.remember('a', editedFirst);
    documents.remember('b', editedSecond);

    // Undo in B reverts B's own edit only. With one shared buffer this would
    // have reverted whichever edit landed last.
    expect(undoOnce(editedSecond).doc.toString()).toBe('const b = 2;');
    expect(editedFirst.doc.toString()).toBe('let a = 1;');
  });

  test('a cached document comes back with its own caret', () => {
    const documents = cache();
    documents.stateFor('a', 'typescript', 'one\ntwo');
    documents.remember('a', documents.stateFor('a', 'typescript', 'one\ntwo').update({
      selection: EditorSelection.cursor(5),
    }).state);

    // A second document is opened in between, which is the switch a tab makes.
    documents.stateFor('b', 'typescript', 'other');

    expect(documents.stateFor('a', 'typescript', 'ignored').selection.main.head).toBe(5);
  });

  test('a cached document keeps the bytes it was last given, not the caller’s', () => {
    const documents = cache();
    const state = documents.stateFor('a', 'typescript', 'original');
    documents.remember('a', state.update({ changes: { from: 8, to: 8, insert: '!' } }).state);

    // The prop the parent passes is stale for one render after a keystroke; the
    // cache must win, or every re-render would revert the character just typed.
    expect(documents.stateFor('a', 'typescript', 'original').doc.toString()).toBe('original!');
  });

  test('drops the least recently used document past the bound', () => {
    const documents = cache();
    for (let index = 0; index < 20; index++) documents.stateFor(`doc-${index}`, 'typescript', `// ${index}`);
    // The first document was evicted, so it comes back empty rather than with
    // its old history — a closed tab's history is the intended cost.
    expect(documents.stateFor('doc-0', 'typescript', 'fresh').doc.toString()).toBe('fresh');
    // A recently used one is still cached.
    expect(documents.stateFor('doc-19', 'typescript', 'fresh').doc.toString()).toBe('// 19');
  });

  test('an explicit drop forgets a closed tab', () => {
    const documents = cache();
    documents.stateFor('a', 'typescript', 'kept');
    documents.drop('a');
    expect(documents.stateFor('a', 'typescript', 'reopened').doc.toString()).toBe('reopened');
  });

  test('wrap and read-only changes report effects only when they moved', () => {
    const documents = cache({ wordWrap: true, readOnly: false });
    documents.stateFor('a', 'typescript', 'x');

    expect(documents.optionsEffects({ wordWrap: true, readOnly: false, themes: SHIKI_THEMES })).toEqual([]);
    expect(documents.optionsEffects({ wordWrap: false, readOnly: false, themes: SHIKI_THEMES })).toHaveLength(1);
    expect(documents.optionsEffects({ wordWrap: false, readOnly: true, themes: SHIKI_THEMES })).toHaveLength(1);
  });

  test('a new document is created read-only when that is the current setting', () => {
    const documents = cache({ readOnly: true });
    const state = documents.stateFor('a', 'typescript', 'viewer');

    // Both halves: `readOnly` stops the commands, `editable` stops typing.
    expect(state.readOnly).toBe(true);
    expect(state.facet(EditorView.editable)).toBe(false as boolean);
  });
});
