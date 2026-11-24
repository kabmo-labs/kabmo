/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Pasting a file into the chat composer, through the component the user
 * actually pastes into: the file becomes a chip AND its filename becomes text
 * in the draft, and the chip's name is that text.
 *
 * The prompt the model receives is assembled from the draft plus the inlined
 * attachment, so a paste that produced a chip named `document` beside an empty
 * draft sent a file the model could not identify. These cases pin the two
 * halves together from the DOM up.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import type { Attachment } from '@/shared/types';
import { ChatInput } from '@/client/components/workspace/chat-timeline/chat-input';
import { delay } from '@/client/hooks/chat/composer/file-reads';
import { restoreRealtime, silenceRealtime } from '@/test-support/silent-socket';

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement',
  'HTMLTextAreaElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'PointerEvent',
  'File', 'Blob', 'FileReader', 'URL', 'requestAnimationFrame',
] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

let container: HTMLElement | null = null;
const sent: Attachment[][] = [];

beforeEach(() => {
  silenceRealtime();
  sent.length = 0;
});

afterEach(async () => {
  const host = container;
  if (host) {
    await act(async () => { render(null, host); });
    host.remove();
  }
  container = null;
  restoreRealtime();
  await delay(50);
});

/** The dock's own shape: the draft is controlled by the parent. */
function Harness() {
  const [value, setValue] = useState('');
  return h(ChatInput, {
    value,
    onChange: setValue,
    onSend: (attachments: Attachment[]) => { sent.push(attachments); },
    isGenerating: false,
    composerModelRef: { current: null },
    sessionId: 'composer-paste-test',
  });
}

/** Types into the draft the way a keystroke does: through the input event. */
async function type(host: HTMLElement, next: string) {
  const field = draftOf(host);
  await act(async () => {
    field.value = next;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

async function mount(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => { render(h(Harness, {}), host); });
  container = host;
  return host;
}

const draftOf = (host: HTMLElement) => host.querySelector('[data-testid="composer-input"]') as HTMLTextAreaElement;

async function paste(host: HTMLElement, files: File[]) {
  const field = draftOf(host);
  field.setSelectionRange(field.value.length, field.value.length);
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files } });
  await act(async () => { field.dispatchEvent(event); });
  await settle();
}

/** Waits for the attachment hook's reads (they go through `FileReader`). */
async function settle() {
  for (let i = 0; i < 3; i += 1) await act(async () => { await delay(5); });
}

describe('pasting a file into the composer', () => {
  test('writes the filename into the draft and attaches the file under that name', async () => {
    const host = await mount();
    await type(host, 'review ');
    await paste(host, [new File(['# notes'], 'notes.md', { type: 'text/markdown' })]);

    expect(draftOf(host).value).toBe('review notes.md');
    const chip = host.querySelector('.composer-attach-row') as HTMLElement;
    expect(chip.textContent).toContain('notes.md');
  });

  test('an image is attached and named in the draft too', async () => {
    const host = await mount();
    await paste(host, [new File(['PNG'], 'shot.png', { type: 'image/png' })]);

    expect(draftOf(host).value).toBe('shot.png');
    expect(host.querySelector('.composer-attach-row')?.textContent).toContain('shot.png');
  });

  test('editing the filename in the draft renames the chip', async () => {
    const host = await mount();
    await paste(host, [new File(['# notes'], 'notes.md', { type: 'text/markdown' })]);

    await type(host, 'notXes.md');

    expect(host.querySelector('.composer-attach-row')?.textContent).toContain('notXes.md');
  });

  test('deleting the filename from the draft detaches the file', async () => {
    const host = await mount();
    await paste(host, [new File(['# notes'], 'notes.md', { type: 'text/markdown' })]);

    await type(host, '');

    expect(host.querySelector('.composer-attach-row')?.textContent).not.toContain('notes.md');
  });

  test('a pasted text file still sends its inlined content under the renamed chip', async () => {
    const host = await mount();
    await paste(host, [new File(['# body'], 'notes.md', { type: 'text/markdown' })]);

    await type(host, 'notXes.md');

    const send = host.querySelector('[aria-label="Send message"]') as HTMLButtonElement | null;
    expect(send).not.toBeNull();
    await act(async () => { send!.click(); });
    await settle();

    expect(sent).toHaveLength(1);
    const [attachment] = sent[0];
    expect(attachment.name).toBe('notXes.md');
    expect(attachment.sourceName).toBe('notes.md');
    expect(attachment.content).toBe('# body');
  });
});
