/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The dirty set is the tab strip's and the close guard's one answer, and it has
 * two sources: a text buffer that differs from its baseline, and a BINARY
 * document (a workbook) whose edits live in the viewer's own draft store — for
 * which all this side keeps is a flag.
 *
 * Driven through `useFileEditor`, because that is the only caller: the hook is
 * an extraction of its state, and a test that mounted it alone would pin the
 * wiring rather than the answer the tab strip reads.
 */

import { describe, expect, test } from 'bun:test';
import { TARGET, createEditorHarness, freshState, stubFetch } from '@/test-support/file-editor.test-util';

const editor = createEditorHarness();

describe('useDirtyTracking', () => {
  test('a binary document marks its own tab dirty, and its save clears the flag', async () => {
    const state = freshState();
    stubFetch(state);
    await editor.mount();
    expect(editor.mounted?.isDirty).toBe(false);

    await editor.run(() => editor.mounted?.setBinaryDirty(true));
    expect(editor.mounted?.isDirty).toBe(true);
    expect([...(editor.mounted?.dirtyKeys ?? [])]).toEqual([String(TARGET.id)]);

    await editor.run(() => editor.mounted?.setBinaryDirty(false));
    expect(editor.mounted?.isDirty).toBe(false);
    expect([...(editor.mounted?.dirtyKeys ?? [])]).toEqual([]);
  });

  // An INLINE target (an attachment chip) deliberately, because it never reads:
  // a tab closed on a read file leaves its baseline behind on purpose, and that
  // baseline alone would read as dirty and hide the flag this test is about.
  test('retain drops the flag of a closed tab', async () => {
    const state = freshState();
    stubFetch(state);
    await editor.mount({ id: 9, name: 'book.xlsx', path: 'book.xlsx', content: 'x' });
    await editor.run(() => editor.mounted?.setBinaryDirty(true));
    expect(editor.mounted?.isDirty).toBe(true);

    // A closed tab's flag would otherwise keep the close guard armed for a file
    // that is not on screen.
    await editor.run(() => editor.mounted?.retain([]));
    expect(editor.mounted?.isDirty).toBe(false);
    expect([...(editor.mounted?.dirtyKeys ?? [])]).toEqual([]);
  });

  test('a text edit and a workbook flag in one tab are one answer', async () => {
    const state = freshState();
    stubFetch(state);
    await editor.mount();

    await editor.run(() => editor.mounted?.setBinaryDirty(true));
    editor.mounted?.onChange('edited by hand');
    await editor.settle();
    expect([...(editor.mounted?.dirtyKeys ?? [])]).toEqual([String(TARGET.id)]);

    // Saving the text leaves the workbook's own draft unsaved, so the tab stays
    // dirty until the viewer clears its flag.
    editor.mounted?.saveNow();
    await editor.settle();
    expect(editor.mounted?.isDirty).toBe(true);
    await editor.run(() => editor.mounted?.setBinaryDirty(false));
    expect(editor.mounted?.isDirty).toBe(false);
  });
});
