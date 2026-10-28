/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Installing a stream language into a LIVE document.
 *
 * The mode is a lazy import, so every document is created without one and gets
 * it later through a compartment reconfigure. Three things must survive that
 * reconfigure, and each is a measured way it could break:
 *
 * - the document itself, or the user's edits are lost;
 * - the undo HISTORY, which is why this is a compartment rather than a new
 *   state;
 * - the comment-token PRECEDENCE: `languageDataAt` returns providers in order
 *   and the commands take the first, so a mode installed after the manual table
 *   would let the manual entry win.
 */

import { describe, expect, test } from 'bun:test';
import type { EditorState } from '@codemirror/state';
import { toggleComment, undo } from '@codemirror/commands';
import { StreamLanguage, syntaxTree } from '@codemirror/language';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { shell } from '@codemirror/legacy-modes/mode/shell';

import { createDocumentCache } from '@/client/components/common/code-surface/documents';
import { SHIKI_THEMES } from '@/shared/lib/code/shiki-themes';

function cache() {
  return createDocumentCache({
    wordWrap: false,
    readOnly: false,
    themes: SHIKI_THEMES,
    indentUnitText: '  ',
    typing: { autoCloseBrackets: false, autocomplete: false },
    onDocChange: () => {},
    onState: () => {},
  });
}

describe('languageEffects', () => {
  test('installs the mode on a live document and leaves the text alone', () => {
    const documents = cache();
    const doc = 'fn f() {\n    let s = "}";\n    g();\n}\n';
    const state = documents.stateFor('a.ts', 'rust', doc);
    documents.remember('a.ts', state);
    expect(syntaxTree(state).length).toBe(0);

    const withMode = state.update({
      effects: documents.languageEffects('a.ts', StreamLanguage.define(rust as never)),
    }).state;

    expect(withMode.doc.toString()).toBe(doc);
    // The tree is what makes pairing token-aware; before the reconfigure there
    // is none at all.
    expect(syntaxTree(withMode).length).toBe(doc.length);
  });

  test('the undo history survives the reconfigure', () => {
    const documents = cache();
    const state = documents.stateFor('b.ts', 'rust', 'fn f() {}\n');
    documents.remember('b.ts', state);

    let live = state.update({ changes: { from: 0, insert: '// hi\n' } }).state;
    live = live.update({ effects: documents.languageEffects('b.ts', StreamLanguage.define(rust as never)) }).state;
    expect(live.doc.toString()).toBe('// hi\nfn f() {}\n');

    let undone = live;
    // `undo` reads the history the state carries; the reconfigure must not have
    // replaced it with an empty one.
    undo({ state: live, dispatch: (transaction) => { undone = transaction.state; } });
    expect(undone.doc.toString()).toBe('fn f() {}\n');
  });

  test('a key the cache does not hold gets no effects', () => {
    // A tab that closed while the mode was loading must not be resurrected.
    const documents = cache();
    documents.stateFor('open.ts', 'rust', 'x\n');
    expect(documents.languageEffects('closed.ts', StreamLanguage.define(rust as never))).toEqual([]);
  });
});

describe('comment tokens with a mode installed', () => {
  /** A state from the cache, with a mode reconfigured in. */
  function stateWithMode(language: string, mode: ReturnType<typeof StreamLanguage.define>) {
    const documents = cache();
    const state = documents.stateFor('k.ts', language, 'let a = 1;\n');
    documents.remember('k.ts', state);
    return state.update({ effects: documents.languageEffects('k.ts', mode) }).state;
  }

  function toggled(state: EditorState): string {
    let next = state;
    toggleComment({ state, dispatch: (transaction) => { next = transaction.state; } });
    return next.doc.toString();
  }

  test('the mode’s own tokens win, because the compartment is installed first', () => {
    // The manual table says `//` for a `typescript` path; the Rust mode says
    // `//` too, so the assertion is on the DATA order rather than the output.
    const state = stateWithMode('typescript', StreamLanguage.define(rust as never));
    const tokens = state.languageDataAt('commentTokens', 0);
    // Two providers, and the mode's is first — which is the ordering the
    // commands rely on.
    expect(tokens.length).toBe(2);
    expect(tokens[0]).toEqual({ line: '//', block: { open: '/*', close: '*/' } });
  });

  test('a shell mode comments with # rather than the path’s //', () => {
    // `bash` maps to the shell mode, whose token is `#`. Before the mode is
    // installed the manual table already says `#` for bash, so this pins that
    // the two agree rather than which one won.
    const state = stateWithMode('bash', StreamLanguage.define(shell as never));
    expect(toggled(state)).toBe('# let a = 1;\n');
  });
});
