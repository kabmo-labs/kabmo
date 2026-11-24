/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Pasting a file into the composer: the attachment and the filename in the
 * draft are one thing.
 *
 * The failure these pin is a chip named `document` beside a draft that says
 * nothing, which is what a paste produced before: the file was attached and the
 * prompt gave the model no way to know which file it was. The reverse failure
 * matters as much — a chip whose name is prose the user typed for something
 * else, or a name that keeps pointing at a file the draft no longer mentions.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useRef, useState } from 'preact/hooks';
import type { Attachment } from '@/shared/types';
import { attachmentName } from '@/shared/lib/chat/attachments';
import { useComposerAttachments } from '@/client/hooks/chat/composer/attachments';
import { delay } from '@/client/hooks/chat/composer/file-reads';
import {
  usePastedAttachments,
  type ComposerPastedAttachments,
} from '@/client/hooks/chat/composer/paste-attachments';

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent',
  'getComputedStyle', 'File', 'Blob', 'FileReader', 'URL', 'FormData', 'requestAnimationFrame',
] as const;

let container: HTMLElement;
/** The latest render's draft, attachments and paste handlers. */
let draft: string;
let attachments: Attachment[];
let paste: ComposerPastedAttachments;
let field: HTMLTextAreaElement;

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
  draft = '';
  attachments = [];
});

/** The composer card's wiring: state, the attachment hook, and the paste hook. */
function Probe() {
  const [value, setValue] = useState('');
  const [list, setList] = useState<Attachment[]>([]);
  draft = value;
  attachments = list;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { addFiles, removeAttachment } = useComposerAttachments({ attachments: list, setAttachments: setList });
  paste = usePastedAttachments({
    value,
    onChange: setValue,
    attachments: list,
    setAttachments: setList,
    acceptFiles: (_files, _incomplete, _references, primed, onAttached) => {
      void addFiles(_files, primed, onAttached);
    },
    removeAttachment,
    textareaRef,
  });
  return h('textarea', {
    ref: (node: HTMLTextAreaElement | null) => { textareaRef.current = node; field = node!; },
    value,
    onInput: (event: Event) => paste.onChange((event.currentTarget as HTMLTextAreaElement).value),
  });
}

async function mount(value = '') {
  container = document.body.appendChild(document.createElement('div'));
  await act(async () => { render(h(Probe, {}), container); });
  if (value) await type(value);
}

/** Replaces the draft the way a keystroke does, through the hook's onChange. */
async function type(next: string) {
  await act(async () => { paste.onChange(next); });
}

async function pasteFiles(files: File[], start = draft.length, end = start) {
  field.setSelectionRange(start, end);
  const event = {
    clipboardData: { files },
    currentTarget: field,
    preventDefault: () => {},
  };
  await act(async () => {
    paste.onPaste(event as unknown as Parameters<ComposerPastedAttachments['onPaste']>[0]);
  });
  await settle();
}

/** Lets the attachment hook's reads land: they go through `FileReader`. */
async function settle() {
  for (let i = 0; i < 3; i += 1) await act(async () => { await delay(5); });
}

const textFile = (name: string, body: string) => new File([body], name, { type: 'text/markdown' });

describe('usePastedAttachments', () => {
  test('writes the filename into the draft and attaches the file', async () => {
    await mount('look at ');
    await pasteFiles([textFile('notes.md', '# hi')]);

    expect(draft).toBe('look at notes.md');
    expect(attachments.map(attachmentName)).toEqual(['notes.md']);
    expect(attachments[0].content).toBe('# hi');
  });

  test('keeps the chip name equal to the text the draft shows', async () => {
    await mount('look at ');
    await pasteFiles([textFile('notes.md', '# hi')]);
    await type('look at notes.md please');

    expect(attachments.map(attachmentName)).toEqual(['notes.md']);
  });

  test('renaming the filename in the draft renames the chip and freezes the source name', async () => {
    await mount('see ');
    await pasteFiles([textFile('notes.md', '# hi')]);
    // Type INSIDE the token: `notes.md` becomes `notXes.md`.
    await type('see notXes.md');

    expect(attachments.map(attachmentName)).toEqual(['notXes.md']);
    // Classification still sees the extension the file arrived with, so the
    // renamed text file is still inlined rather than dropped as binary.
    expect(attachments[0].sourceName).toBe('notes.md');
  });

  test('text typed right after a filename is prose, not part of its name', async () => {
    await mount('see ');
    await pasteFiles([textFile('notes.md', '# hi')]);
    await type('see notes.md and this');

    expect(attachments.map(attachmentName)).toEqual(['notes.md']);
  });

  test('rewriting the sentence detaches the file instead of naming it after prose', async () => {
    await mount('look at ');
    await pasteFiles([textFile('notes.md', '# hi')]);
    await type('write tests');

    expect(attachments).toEqual([]);
  });

  test('deleting the filename detaches the file', async () => {
    await mount('see ');
    await pasteFiles([textFile('notes.md', '# hi')]);
    await type('see ');

    expect(attachments).toEqual([]);
    expect(draft).toBe('see ');
  });

  test('two pasted files are tracked apart', async () => {
    await mount();
    await pasteFiles([textFile('a.md', 'a')]);
    await type(`${draft} and `);
    await pasteFiles([textFile('b.md', 'b')]);

    expect(draft).toBe('a.md and b.md');
    expect(attachments.map(attachmentName)).toEqual(['a.md', 'b.md']);

    // Renaming the second one leaves the first alone.
    await type('a.md and catatan');
    expect(attachments.map(attachmentName)).toEqual(['a.md', 'catatan']);
  });

  test('removing a chip stops tracking its filename', async () => {
    await mount();
    await pasteFiles([textFile('a.md', 'a')]);
    const [att] = attachments;
    await act(async () => { paste.onRemoveAttachment(att.id); });
    expect(attachments).toEqual([]);

    // The text is the user's prose now; editing it must not resurrect the file.
    await type('a.mdx');
    expect(attachments).toEqual([]);
  });

  test('a paste with no files keeps the browser default', async () => {
    await mount('typed');
    const event = { clipboardData: { files: [] }, currentTarget: field, preventDefault: () => { throw new Error('prevented'); } };
    await act(async () => {
      paste.onPaste(event as unknown as Parameters<ComposerPastedAttachments['onPaste']>[0]);
    });
    expect(draft).toBe('typed');
  });
});
