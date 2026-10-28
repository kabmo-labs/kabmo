/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two hand-off stores an outline row relies on.
 *
 * `editor-document` is what the Files panel describes, and `line-reveal` is what
 * a row asks the editor to do. Both are process-wide singletons, so the tests
 * that matter are the ones about LIFETIME and IDENTITY:
 *
 * - a replaced publisher must not blank the slot on unmount (a workspace switch
 *   mounts the next editor before the previous one's cleanup runs);
 * - a re-render with an unchanged document must not notify (otherwise every
 *   hover re-scanned the buffer);
 * - a served request must be cleared exactly once, or a remount re-fires a jump
 *   the reader already took.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  clearEditorDocument,
  getEditorDocument,
  publishEditorDocument,
  resetEditorDocument,
  subscribeEditorDocument,
  type EditorDocument,
} from '@/client/lib/editor-document';
import { getLineReveal, setLineReveal, subscribeLineReveal } from '@/client/lib/line-reveal';

const DOC: EditorDocument = {
  path: 'src/a.ts',
  name: 'a.ts',
  content: 'export const a = 1;',
  language: 'typescript',
  state: 'ready',
  note: null,
  preview: false,
};

afterEach(() => {
  resetEditorDocument();
  setLineReveal(null);
});

describe('editor document slot', () => {
  test('publishing notifies subscribers once, and an unchanged document does not', () => {
    let calls = 0;
    const unsubscribe = subscribeEditorDocument(() => { calls += 1; });
    const owner = {};

    publishEditorDocument(owner, DOC);
    expect(calls).toBe(1);
    expect(getEditorDocument()).toEqual(DOC);

    // Same content, fresh object — the shape of every re-render.
    publishEditorDocument(owner, { ...DOC });
    expect(calls).toBe(1);

    publishEditorDocument(owner, { ...DOC, content: 'export const a = 2;' });
    expect(calls).toBe(2);
    unsubscribe();
  });

  test('a replaced publisher keeps the slot when the older one clears', () => {
    const first = {};
    const second = {};
    publishEditorDocument(first, DOC);
    publishEditorDocument(second, { ...DOC, path: 'src/b.ts', name: 'b.ts' });

    // The first editor unmounts after the second mounted over it.
    clearEditorDocument(first);
    expect(getEditorDocument().path).toBe('src/b.ts');

    clearEditorDocument(second);
    expect(getEditorDocument().path).toBeNull();
    expect(getEditorDocument().state).toBe('idle');
  });
});

describe('line reveal store', () => {
  test('a request is published, read and cleared once', () => {
    const seen: Array<string | null> = [];
    const unsubscribe = subscribeLineReveal(() => seen.push(getLineReveal()?.path ?? null));

    setLineReveal({ path: 'src/a.ts', line: 42 });
    expect(getLineReveal()).toEqual({ path: 'src/a.ts', line: 42 });

    setLineReveal(null);
    expect(getLineReveal()).toBeNull();
    expect(seen).toEqual(['src/a.ts', null]);
    unsubscribe();
  });
});
