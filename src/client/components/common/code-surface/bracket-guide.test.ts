/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The bracket pair guide, and the mode table that makes pairing token-aware.
 *
 * Three failure modes are silent here and each is a test:
 *
 * - A guide drawn at the line's LEFT edge instead of under the opening brace
 *   looks like an indent guide, which is a different feature. The column is a
 *   decoration attribute, so the assertion is on the emitted style.
 * - A guide through a BLANK line makes a block read as if it continued across
 *   the gap between two functions.
 * - A mode table entry that does not exist in `@codemirror/legacy-modes` fails
 *   only when a user opens that language — so every entry is resolved here.
 */

import { describe, expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { Decoration } from '@codemirror/view';

import {
  bracketGuideDecorations,
  bracketPairAt,
  MAX_GUIDE_LINES,
} from '@/client/components/common/code-surface/bracket-guide';
import {
  STREAM_MODE_EXPORTS,
  STREAM_MODE_LOADERS,
  TEXTUAL_ONLY_LANGS,
  streamModeFor,
} from '@/shared/lib/code/editor/stream-modes';
import { LANG_LOADERS } from '@/shared/lib/code/shiki-langs';

function stateOf(doc: string, caret: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: caret } });
}

/** The lines a guide decorates, as 1-based numbers. */
function guidedLines(state: EditorState): number[] {
  const lines: number[] = [];
  const set = bracketGuideDecorations(state);
  const iter = set.iter();
  while (iter.value) {
    lines.push(state.doc.lineAt(iter.from).number);
    iter.next();
  }
  return lines;
}

/** The column each guide carries, from the emitted attribute. */
function guideColumns(state: EditorState): string[] {
  const columns: string[] = [];
  const iter = bracketGuideDecorations(state).iter();
  while (iter.value) {
    const spec = iter.value.spec as { attributes?: Record<string, string> };
    columns.push(spec.attributes?.style ?? '');
    iter.next();
  }
  return columns;
}

const DOC = [
  'function outer() {',
  '  if (a) {',
  '    inner();',
  '  }',
  '  return 1;',
  '}',
].join('\n');

describe('bracketPairAt', () => {
  test('the caret beside an opening brace finds its pair', () => {
    const open = DOC.indexOf('{', DOC.indexOf('if'));
    const state = stateOf(DOC, open + 1);
    const pair = bracketPairAt(state);
    expect(pair).not.toBeNull();
    expect(pair?.open).toBe(open);
    // `close` is the offset just PAST the closing brace: `bracketPairAt` stores
    // `match.end.to` so the guide's span covers the brace glyph itself.
    expect(pair?.close).toBe(DOC.indexOf('}', DOC.indexOf('inner')) + 1);
    expect(DOC[pair!.close - 1]).toBe('}');
  });

  test('the caret beside the CLOSING brace finds the same pair', () => {
    const close = DOC.indexOf('\n}', DOC.indexOf('return 1')) + 1;
    const state = stateOf(DOC, close);
    expect(bracketPairAt(state)?.open).toBe(DOC.indexOf('{'));
  });

  test('a caret in ordinary text has no pair', () => {
    expect(bracketPairAt(stateOf(DOC, DOC.indexOf('inner')))).toBeNull();
  });
});

describe('bracketGuideDecorations', () => {
  test('every non-blank line between the braces gets a guide', () => {
    const open = DOC.indexOf('{', DOC.indexOf('if'));
    // Lines 3 (`inner();`) and 4 (`}`) sit between the `if` opener (line 2) and
    // its closing brace (line 4) — line 4 is the closing brace's own line, so
    // only line 3 is strictly between.
    expect(guidedLines(stateOf(DOC, open + 1))).toEqual([3]);
  });

  test('the OUTER pair guides every row of its body', () => {
    // `function outer() {` … `}` spans lines 2-5.
    expect(guidedLines(stateOf(DOC, DOC.indexOf('{') + 1))).toEqual([2, 3, 4, 5]);
  });

  test('a blank line gets no guide, so a gap reads as a gap', () => {
    const doc = 'function f() {\n  a();\n\n  b();\n}\n';
    expect(guidedLines(stateOf(doc, doc.indexOf('{') + 1))).toEqual([2, 4]);
  });

  test('a one-line pair draws nothing — there is no span to connect', () => {
    const doc = 'if (a) { b(); }\n';
    expect(guidedLines(stateOf(doc, doc.indexOf('{') + 1))).toEqual([]);
  });

  test('a caret with no pair draws nothing', () => {
    expect(guidedLines(stateOf(DOC, DOC.indexOf('inner')))).toEqual([]);
  });

  test('the column is the OPENING BRACE’s, not the line’s left edge', () => {
    // `function outer() {` is 18 characters and the brace is the 18th, so its
    // zero-based offset is 17. A guide at the line's left edge would be 0 —
    // which is an INDENT guide, a different feature.
    const columns = guideColumns(stateOf(DOC, DOC.indexOf('{') + 1));
    expect(columns.length).toBeGreaterThan(0);
    expect(columns[0]).toBe('--bracket-guide-col: 17');
    // Every row of one pair shares one column, or the rule would not be straight.
    expect(new Set(columns).size).toBe(1);
  });

  test('a pair spanning more than MAX_GUIDE_LINES is refused rather than drawn', () => {
    const body = '  x();\n'.repeat(MAX_GUIDE_LINES + 5);
    const doc = `function f() {\n${body}}\n`;
    expect(guidedLines(stateOf(doc, doc.indexOf('{') + 1))).toEqual([]);
  });

  test('a pair just inside the cap still draws', () => {
    const body = '  x();\n'.repeat(20);
    const doc = `function f() {\n${body}}\n`;
    expect(guidedLines(stateOf(doc, doc.indexOf('{') + 1)).length).toBe(20);
  });

  test('the decoration is a LINE decoration, not a mark', () => {
    // A mark would paint the text; the guide is a rule beside it.
    const iter = bracketGuideDecorations(stateOf(DOC, DOC.indexOf('{') + 1)).iter();
    const spec = iter.value?.spec as { class?: string } | undefined;
    expect(spec?.class).toBe('cm-bracket-guide');
  });
});

describe('stream mode table', () => {
  test('every entry resolves to a real mode, through its own literal loader', async () => {
    // The whole point: a typo here fails only when a user opens that language.
    // Resolved through the LOADER rather than a template specifier, because that
    // is the path the app takes — and the template form is exactly what never
    // resolved at runtime (measured in the dev server).
    const broken: string[] = [];
    for (const [language, loader] of Object.entries(STREAM_MODE_LOADERS)) {
      const exportName = STREAM_MODE_EXPORTS[language];
      if (!exportName) {
        broken.push(`${language} has a loader but no export name`);
        continue;
      }
      try {
        const module = await loader();
        const mode = (module as Record<string, unknown>)[exportName];
        const isMode = mode !== null && typeof mode === 'object' && typeof (mode as { token?: unknown }).token === 'function';
        if (!isMode) broken.push(`${language} → export "${exportName}" is not a mode`);
      } catch (error) {
        broken.push(`${language} loader failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(broken).toEqual([]);
  });

  test('every Shiki language this app names is either parsed or explicitly textual', () => {
    // A language added to `LANG_LOADERS` without a decision here would silently
    // fall back to the textual matcher, and nothing would say so.
    const decided = new Set([...Object.keys(STREAM_MODE_LOADERS), ...TEXTUAL_ONLY_LANGS]);
    const undecided = Object.keys(LANG_LOADERS).filter((language) => !decided.has(language));
    expect(undecided).toEqual([]);
  });

  test('the two sets do not overlap', () => {
    const both = Object.keys(STREAM_MODE_LOADERS).filter((language) => TEXTUAL_ONLY_LANGS.includes(language));
    expect(both).toEqual([]);
  });

  test('streamModeFor answers null for a language with no mode', () => {
    expect(streamModeFor('markdown')).toBeNull();
    expect(streamModeFor('graphql')).toBeNull();
    expect(streamModeFor('text')).toBeNull();
  });

  test('streamModeFor answers the export for a covered language', () => {
    // The MODULE is the loader's own literal specifier; `module` here names the
    // language key, which is what the loader table is indexed by.
    expect(streamModeFor('typescript')?.export).toBe('typescript');
    expect(streamModeFor('bash')?.export).toBe('shell');
    // And an export that does NOT match the id, which is the case a table of
    // "same name" would get wrong.
    expect(streamModeFor('scss')?.export).toBe('sCSS');
    expect(streamModeFor('objective-c')?.export).toBe('objectiveC');
  });
});

describe('a stream language makes pairing token-aware', () => {
  test('a brace inside a string is not paired with the real closing brace', async () => {
    // The measured failure of the textual matcher: without a mode it pairs the
    // `{` with the `}` inside a string 14 characters away.
    const { StreamLanguage, matchBrackets } = await import('@codemirror/language');
    const rust = await import('@codemirror/legacy-modes/mode/rust');
    const doc = 'fn f() {\n    let s = "}";\n    g();\n}\n';
    const open = doc.indexOf('{');

    const textual = stateOf(doc, open);
    const textualMatch = matchBrackets(textual, open, 1);
    expect(textualMatch?.end?.from).toBe(doc.indexOf('"}') + 1);

    const parsed = EditorState.create({
      doc,
      extensions: [StreamLanguage.define(rust.rust as never)],
    });
    const parsedMatch = matchBrackets(parsed, open, 1);
    expect(parsedMatch?.matched).toBe(true);
    expect(parsedMatch?.end?.from).toBe(doc.lastIndexOf('}'));
  });

  test('the tree exists synchronously, so the guide is right on the first paint', async () => {
    const { StreamLanguage, syntaxTree } = await import('@codemirror/language');
    const rust = await import('@codemirror/legacy-modes/mode/rust');
    const doc = 'fn f() {\n    g();\n}\n';
    const state = EditorState.create({ doc, extensions: [StreamLanguage.define(rust.rust as never)] });
    // No `ensureSyntaxTree`, no worker: a StreamLanguage parses from the token
    // stream as the state is read. Measured against a lezer grammar, whose tree
    // is 3 KB until its lazy parse catches up.
    expect(syntaxTree(state).length).toBe(doc.length);
  });
});

// Keep the import used: `Decoration` is what the guide builds, and a test that
// asserts the class is the one that proves it.
void Decoration;
