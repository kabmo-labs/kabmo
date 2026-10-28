/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's attachment lifecycle: what `useComposerAttachments` stores,
 * what it reports, and which list the send path may trust.
 *
 * Three failures this pins, each of which produced a wrong prompt:
 *
 * - A drop registers its files in this hook before the component re-renders, so
 *   a send clicked immediately afterwards read an empty `attachments` prop,
 *   cleared the composer and dispatched nothing. `peek()` is the authoritative
 *   list and must show the entry the moment `addFiles` returns.
 * - A read that yields no body while the file was accepted (a promised file
 *   whose bytes never arrive, or a 0-byte file) must land in `unreadable` — a
 *   chip whose bytes never came would otherwise name a file the model cannot
 *   see.
 * - `readyForSend` must return the list AS IT STANDS once the reads land: a
 *   caller that captured the array earlier holds the pre-read entry and sends
 *   an attachment with no content.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import type { Attachment } from '@/shared/types';
import { attachmentHasPayload, toAttachmentList } from '@/shared/lib/chat/attachments';
import {
  useComposerAttachments,
  type ComposerAttachments,
} from '@/client/hooks/chat/composer/attachments';

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent',
  'getComputedStyle', 'File', 'Blob', 'FileReader', 'URL', 'FormData',
] as const;

let container: HTMLElement;
/** The latest render's hook result and the state it mirrors into. */
let api: ComposerAttachments;
let prop: Attachment[];

/** Drives the hook the way the composer card does: it owns the state prop. */
function Probe() {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  prop = attachments;
  api = useComposerAttachments({ attachments, setAttachments });
  return null;
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve(); });
}

/** The runner's own globals, put back once this file's DOM work is done. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  prop = [];
});

async function mount() {
  container = document.body.appendChild(document.createElement('div'));
  await act(async () => { render(h(Probe, {}), container); });
}

function textFile(name: string, body: string, type = 'text/markdown'): File {
  return new File([body], name, { type });
}

describe('useComposerAttachments', () => {
  test('a text file is stored with its content and is visible to peek() at once', async () => {
    await mount();
    // No act() around the await: `peek()` must be authoritative the moment the
    // call returns, not one render later.
    const outcome = await api.addFiles([textFile('notes.md', '# hi')]);

    expect(outcome.added).toBe(1);
    expect(outcome.skipped).toEqual([]);
    expect(outcome.unreadable).toEqual([]);
    const [stored] = api.peek();
    expect(stored.name).toBe('notes.md');
    expect(stored.size).toBe(4);
    expect(stored.content).toBe('# hi');
    expect(stored.preview).toBe('');
    expect(attachmentHasPayload(stored)).toBe(true);

    await settle();
    expect(prop.map((a) => a.name)).toEqual(['notes.md']);
  });

  test('an image stores its base64 payload and a blob preview, never inline text', async () => {
    await mount();
    await act(async () => { await api.addFiles([new File(['PNG'], 'shot.png', { type: 'image/png' })]); });

    const [stored] = api.peek();
    expect(stored.dataBase64).toBe('UE5H');
    expect(stored.content).toBeUndefined();
    expect(stored.preview.startsWith('blob:')).toBe(true);
    expect(attachmentHasPayload(stored)).toBe(true);
  });

  test('a read that yields no body is reported in unreadable, never silently attached', async () => {
    await mount();
    const outcome = await api.addFiles([new File([], 'empty.txt', { type: 'text/plain' })]);

    // The chip still exists (the file was accepted) but the caller is told its
    // bytes never arrived — the alternative is a prompt naming an empty file.
    expect(outcome.added).toBe(1);
    expect(outcome.unreadable).toEqual(['empty.txt']);
    expect(attachmentHasPayload(api.peek()[0])).toBe(false);
  });

  test('the text budget spans the composer, so a later batch is refused', async () => {
    await mount();
    const first = Array.from({ length: 10 }, (_, i) => textFile(`f${i}.md`, 'x'));
    expect((await api.addFiles(first)).added).toBe(10);

    const outcome = await api.addFiles([textFile('eleventh.md', 'x')]);
    expect(outcome.added).toBe(0);
    expect(outcome.skipped.map((f) => f.name)).toEqual(['eleventh.md']);
    expect(api.peek().length).toBe(10);
  });

  test('readyForSend waits for an in-flight read and returns the patched entry', async () => {
    await mount();
    const pending = api.addFiles([textFile('late.md', '# late')]);
    // The entry exists with no content yet; the list must not be read now.
    expect(api.peek()[0].content).toBeUndefined();

    const outgoing = await api.readyForSend();
    expect(outgoing[0].content).toBe('# late');
    expect(attachmentHasPayload(outgoing[0])).toBe(true);
    await pending;
  });

  test('removeAttachment drops the entry and revokes a blob preview', async () => {
    await mount();
    const revoked: string[] = [];
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = (url: string) => { revoked.push(url); };
    try {
      await act(async () => { await api.addFiles([new File(['PNG'], 'shot.png', { type: 'image/png' })]); });
      const { id, preview } = api.peek()[0];
      await act(async () => { api.removeAttachment(id); });
      expect(api.peek()).toEqual([]);
      expect(revoked).toEqual([preview]);
    } finally {
      URL.revokeObjectURL = original;
    }
  });

  test('clear empties the hook list and the mirrored state together', async () => {
    await mount();
    await act(async () => { await api.addFiles([textFile('a.md', 'a')]); });
    await act(async () => { api.clear(); });
    expect(api.peek()).toEqual([]);
    await settle();
    expect(prop).toEqual([]);
  });
});

describe('toAttachmentList', () => {
  test('fills the display fields a committed-history row omits', () => {
    const list = toAttachmentList([
      { name: 'a.md', content: '# a' },
      { name: 'b.md' },
    ]);
    expect(list.map((a) => a.id)).toEqual(['attachment-1', 'attachment-2']);
    expect(list.map((a) => a.preview)).toEqual(['', '']);
    expect(list[0].file).toBeUndefined();
  });

  test('keeps ids and previews that are already there, and tolerates no list', () => {
    const list = toAttachmentList([{ id: 'keep', name: 'a.md', preview: 'data:image/png;base64,QQ==' }]);
    expect(list[0].id).toBe('keep');
    expect(list[0].preview).toBe('data:image/png;base64,QQ==');
    expect(toAttachmentList(undefined)).toEqual([]);
  });

  test('a replayed row is not mistaken for an unreadable one', () => {
    // `File` does not survive JSON; the payload must be judged from what did.
    const [text] = toAttachmentList([{ name: 'a.md', content: '# a' }]);
    expect(attachmentHasPayload(text)).toBe(true);
    const [image] = toAttachmentList([{ name: 'a.png', type: 'image/png', preview: 'data:image/png;base64,QQ==' }]);
    expect(attachmentHasPayload(image)).toBe(true);
  });
});
