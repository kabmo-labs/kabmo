/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useFileEditor`'s WRITE contract for a file that was deleted under its tab.
 *
 * The buffer is still on screen and still editable, so a write is not refused
 * outright — it is REFUSED TO A TIMER. Two rules follow from that, and each
 * fails silently if broken:
 *
 * - the debounced autosave (and the closing flush) must stand down, or a
 *   keystroke recreates a file the user deleted, as a side effect of typing;
 * - an explicit Save must ASK first, because recreating the file is a decision
 *   and the deletion may have been the user's own.
 *
 * The read half of the hook lives in `use-file-editor.test.ts`; both share the
 * mount in `@/test-support/file-editor.test-util`.
 */

import { describe, expect, test } from 'bun:test';
import {
  createEditorHarness,
  freshState,
  stubFetch,
  withImmediateTimers,
} from '@/test-support/file-editor.test-util';

const editor = createEditorHarness();

describe('a file deleted under the tab', () => {
  test('a keystroke does not autosave a deleted file', async () => {
    const state = freshState();
    stubFetch(state);
    await editor.mount(undefined, { missing: true });

    await withImmediateTimers(async () => {
      editor.mounted?.onChange('typed while the file was gone');
      await editor.settle();
    });

    expect(state.writes).toBe(0);
    // The buffer still moved: refusing the write is not refusing the edit.
    expect(editor.mounted?.content).toBe('typed while the file was gone');
    expect(editor.mounted?.isDirty).toBe(true);
  });

  // The other half of the same rule: a file that IS present autosaves on the
  // debounce. Without this, a guard that never writes would pass the test above.
  test('a keystroke autosaves a file that is still on disk', async () => {
    const state = freshState();
    stubFetch(state);
    await editor.mount(undefined, { missing: false });

    await withImmediateTimers(async () => {
      editor.mounted?.onChange('edited while present');
      await editor.settle();
    });

    expect(state.writes).toBe(1);
    expect(state.body).toBe('edited while present');
  });

  // Recreating a deleted file is a decision. The Save has to ASK, and nothing
  // may reach the disk until the user answers.
  test('Save asks instead of writing, and confirm writes', async () => {
    const state = freshState();
    stubFetch(state);
    await editor.mount(undefined, { missing: true });

    editor.mounted?.onChange('restore me');
    await editor.settle();
    editor.mounted?.saveNow();
    await editor.settle();

    expect(state.writes).toBe(0);
    expect(editor.mounted?.saveMissingConfirm).toBe(true);

    editor.mounted?.confirmSaveMissing();
    await editor.settle();

    expect(state.writes).toBe(1);
    expect(state.body).toBe('restore me');
    expect(editor.mounted?.saveMissingConfirm).toBe(false);
  });

  test('cancel writes nothing and keeps the buffer dirty', async () => {
    const state = freshState();
    stubFetch(state);
    await editor.mount(undefined, { missing: true });

    editor.mounted?.onChange('restore me');
    await editor.settle();
    editor.mounted?.saveNow();
    await editor.settle();
    editor.mounted?.cancelSaveMissing();
    await editor.settle();

    expect(state.writes).toBe(0);
    expect(editor.mounted?.saveMissingConfirm).toBe(false);
    expect(editor.mounted?.isDirty).toBe(true);
  });

  // A file that is present writes exactly as it always did — the guard must not
  // turn every editor into a confirm dialog.
  test('a present file still saves without asking', async () => {
    const state = freshState();
    stubFetch(state);
    await editor.mount(undefined, { missing: false });

    editor.mounted?.saveNow();
    await editor.settle();

    expect(state.writes).toBe(1);
    expect(editor.mounted?.saveMissingConfirm).toBe(false);
  });
});
