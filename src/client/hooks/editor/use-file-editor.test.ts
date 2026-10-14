/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `useFileEditor` revalidation contract: the read side — a re-read that lands
 * mid-typing must not replace the buffer, `loaded` must mean "real bytes are on
 * screen", and the file's own line ending must survive a write.
 *
 * The WRITE side (the debounced autosave, the explicit Save, and the deleted
 * file that stands both down) lives in `use-file-editor-writes.test.ts`; both
 * files share the mount in `@/test-support/file-editor.test-util`.
 */

import { describe, expect, test } from 'bun:test';
import {
  DISK,
  createEditorHarness,
  freshState,
  stubFetch,
} from '@/test-support/file-editor.test-util';

const editor = createEditorHarness();

describe('useFileEditor revalidation', () => {
  test('reset re-reads from disk without blanking the open file', async () => {
    const state = freshState();
    stubFetch(state);
    await editor.mount();
    expect(editor.mounted?.content).toBe(DISK);

    // The refresh a landed write triggers, with newer bytes now on disk.
    state.body = `${DISK}const c = 3;\n`;
    await editor.run(() => editor.mounted?.reset());
    await editor.settle();

    expect(state.reads).toBe(2);
    expect(editor.mounted?.content).toBe(state.body);
  });

  test('a read that lands mid-typing does not replace the buffer', async () => {
    const state = freshState();
    stubFetch(state);
    await editor.mount();

    await editor.run(() => {
      editor.mounted?.onChange('edited by hand');
      editor.mounted?.reset();
    });
    await editor.settle();

    expect(state.reads).toBe(2);
    expect(editor.mounted?.content).toBe('edited by hand');
  });

  // A consumer that must act only on real bytes (the search-reveal hand-off)
  // cannot use `isLoading` as its gate: it starts `false` on the first render,
  // so a request served then would match against an EMPTY buffer. `loaded` is
  // the honest signal, and these two assertions pin both ends of it.
  test('loaded is false until the bytes arrive, then true', async () => {
    const state = freshState();
    stubFetch(state);
    // A read that resolves only when the test lets it, so the pre-arrival
    // render is observable.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      await gate;
      return realFetch(input, init);
    }) as typeof fetch;

    await editor.mount();
    expect(editor.mounted?.isLoading).toBe(true);
    expect(editor.mounted?.loaded).toBe(false);

    release();
    await editor.settle();

    expect(editor.mounted?.loaded).toBe(true);
    expect(editor.mounted?.content).toBe(DISK);
  });

  // A textarea's API value drops every CR, so a CRLF file reaches the buffer as
  // LF — and multipart/form-data turns a bare LF back into CRLF, so the payload
  // cannot carry the ending. The file's own ending therefore travels as its own
  // field, and losing it rewrote every line of the file on a one-character edit.
  test('a CRLF file is saved as CRLF after an edit', async () => {
    const state = freshState('const a = 1;\r\nconst b = 2;\r\n');
    stubFetch(state);
    await editor.mount();

    expect(editor.mounted?.content).toBe('const a = 1;\nconst b = 2;\n');

    editor.mounted?.onChange('const a = 1;\nconst c = 3;\n');
    await editor.settle();
    editor.mounted?.saveNow();
    await editor.settle();

    expect(state.writes).toBe(1);
    expect(state.body).toBe('const a = 1;\nconst c = 3;\n');
    expect(state.sentEol).toBe('crlf');
  });

  test('an LF file is saved as LF', async () => {
    const state = freshState();
    stubFetch(state);
    await editor.mount();

    editor.mounted?.onChange('const a = 1;\n');
    await editor.settle();
    editor.mounted?.saveNow();
    await editor.settle();

    expect(state.body).toBe('const a = 1;\n');
    expect(state.sentEol).toBe('lf');
  });
});

describe('useFileEditor unsupported files', () => {
  test('a kind refusal reports the server sentence as unsupported', async () => {
    const state = freshState();
    state.readRefusal = { status: 415, error: 'This file is not text, so it cannot be shown in the editor.', kind: 'binary' };
    stubFetch(state);
    await editor.mount();

    // Both flags are set: `loadError` is the ONE gate the write path consults
    // (a refused read leaves an empty buffer, so Save must stay disabled), and
    // `unsupported` is what lets the surface say WHY without blaming the read.
    expect(editor.mounted?.unsupported).toContain('not text');
    expect(editor.mounted?.loadError).toContain('not text');
  });

  test('an oversized refusal carries the size wording', async () => {
    const state = freshState();
    state.readRefusal = { status: 415, error: 'This file is 9.00 MB — larger than the 5.00 MB the editor opens.', kind: 'too-large' };
    stubFetch(state);
    await editor.mount();

    expect(editor.mounted?.unsupported).toContain('9.00 MB');
  });

  test('a transport failure is a loadError and NOT unsupported', async () => {
    const state = freshState();
    // A 500 with no kind: something went wrong, which is not a property of the
    // file. The pane must word it as a failed read, not as an unopenable file.
    state.readRefusal = { status: 500, error: 'boom' };
    stubFetch(state);
    await editor.mount();

    expect(editor.mounted?.loadError).toBe('boom');
    expect(editor.mounted?.unsupported).toBeNull();
  });

  test('a refusal still disables the write path', async () => {
    const state = freshState();
    state.readRefusal = { status: 415, error: 'This file is not text.', kind: 'binary' };
    stubFetch(state);
    await editor.mount();
    await editor.run(() => editor.mounted?.saveNow());
    await editor.settle();

    // The buffer is empty after a refused read, so a Save would write that
    // emptiness over the real file. Zero writes is the whole point of keeping
    // the refusal on `loadError`.
    expect(state.writes).toBe(0);
  });
});
