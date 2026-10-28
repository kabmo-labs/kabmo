/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The attach-and-send pipeline: the code between "a file arrived" and "a
 * prompt is dispatched". Each case below was a bug once: a send clicked right
 * after a drop read the component's stale prop and dispatched nothing; a send
 * carrying only unread attachments went out with an empty body; a double
 * click dispatched the same batch twice; a refused reference reported one
 * generic reason the user could not act on. The growth half moved to
 * `auto-grow.test.ts` so both files stay under the 350-line ceiling.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import type { Attachment } from '@/shared/types';
import { DROP_LIMIT_NOTICE } from '@/client/hooks/chat/composer/file-drop';
import { READ_RETRY_MS, delay } from '@/client/hooks/chat/composer/file-reads';
import { useComposerPipeline, type ComposerPipeline } from '@/client/hooks/chat/composer/pipeline';

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent',
  'getComputedStyle', 'File', 'Blob', 'FileReader', 'URL', 'FormData',
] as const;

/** The runner's own fetch, restored after every test that stubs one. */
/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

let container: HTMLElement;

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
  globalThis.fetch = nativeFetch;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  globalThis.fetch = nativeFetch;
  sent.length = 0;
  sentHooks = 0;
  current = [];
  value = '';
  rootPath = null;
});

/**
 * Drains the pipeline's own work: the `delay(0)` the send path awaits before it
 * reads the attachment list back, plus the renders that lands. Awaiting the
 * module's own zero-delay helper is exact — no guessed duration.
 */
async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => { await delay(0); });
  }
}

/**
 * Waits for a state the pipeline produces, draining renders as it goes and
 * stopping the moment the state holds. A read that comes back empty retries on
 * the module's own backoff, so the wait steps by that constant rather than
 * guessing a duration.
 */
async function waitFor(check: () => boolean, rounds = 12) {
  for (let i = 0; i < rounds; i += 1) {
    if (check()) return;
    await act(async () => { await delay(READ_RETRY_MS); });
  }
}

// ── useComposerPipeline ─────────────────────────────────────────────────────

let api: ComposerPipeline;
/** The attachments the probe last rendered, read instead of a hook accessor. */
let current: Attachment[] = [];
/** Seeds the probe's attachment state, for a case that starts from a replayed row. */
let seed: (next: Attachment[]) => void;
/** Every dispatch, so a test can assert what was NOT sent. */
const sent: Array<{ attachments: Attachment[] }> = [];
/** Every `onSent`, so a test can assert the collapse followed a real dispatch. */
let sentHooks = 0;
let value = '';
let rootPath: string | null = null;

function PipelineProbe() {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  current = attachments;
  seed = setAttachments;
  api = useComposerPipeline({
    attachments,
    setAttachments,
    value,
    disabled: false,
    rootPath,
    onSend: (attachmentsOut) => sent.push({ attachments: attachmentsOut }),
    onSent: () => { sentHooks += 1; },
  });
  return null;
}

async function mountPipeline() {
  container = document.body.appendChild(document.createElement('div'));
  await act(async () => { render(h(PipelineProbe, {}), container); });
}

/** A `DataTransfer` carrying a `text/uri-list` reference, as a Finder drag does. */
function fileTransfer(reference: string): DataTransfer {
  return {
    types: ['text/uri-list'],
    files: [],
    getData: (type: string) => (type.toLowerCase() === 'text/uri-list' ? reference : ''),
  } as unknown as DataTransfer;
}

function textFile(name: string, body: string): File {
  return new File([body], name, { type: 'text/markdown' });
}

/** Replaces the global fetch with a canned answer for the reference resolver. */
function stubFetch(response: { ok: boolean; status: number; json: () => Promise<unknown> }) {
  globalThis.fetch = (async () => response) as unknown as typeof fetch;
}

describe('useComposerPipeline', () => {
  test('an empty composer dispatches nothing', async () => {
    await mountPipeline();
    await act(async () => { api.submit(); });
    await settle();
    expect(sent).toEqual([]);
  });

  test('text alone is sent with no attachments and no notice', async () => {
    await mountPipeline();
    value = 'hello';
    await act(async () => { render(h(PipelineProbe, {}), container); });
    await act(async () => { api.submit(); });
    await waitFor(() => sent.length === 1);
    expect(sent.length).toBe(1);
    expect(sent[0].attachments).toEqual([]);
    expect(api.notice).toBeNull();
  });

  test('a send right after a drop waits for the read and dispatches the full attachment', async () => {
    await mountPipeline();
    // No settle in between: the send is clicked in the same tick the drop
    // registered its files, so the component's prop is still a frame behind and
    // only the hook's own list has them.
    await act(async () => {
      api.acceptFiles([textFile('notes.md', '# body')]);
      api.submit();
    });
    await waitFor(() => sent.length === 1);

    expect(sent.length).toBe(1);
    expect(sent[0].attachments.map((a) => a.content)).toEqual(['# body']);
  });

  test('attachments that carry no body are reported, never dispatched as an empty prompt', async () => {
    await mountPipeline();
    await act(async () => { api.acceptFiles([new File([], 'empty.md', { type: 'text/markdown' })]); });
    // A genuinely empty file is only settled once its reads have retried out.
    await waitFor(() => api.notice !== null);
    await act(async () => { api.submit(); });
    await settle();

    expect(sent).toEqual([]);
    expect(api.notice).toBe('"empty.md" could not be read and was not attached.');
  });

  test('a replayed image with only a data-URL preview is still readable', async () => {
    await mountPipeline();
    await act(async () => {
      seed([{ id: 'i', name: 'shot.png', type: 'image/png', preview: 'data:image/png;base64,UE5H' }]);
    });
    await act(async () => { api.submit(); });
    await waitFor(() => sent.length === 1);
    // Judging the image by `dataBase64` alone would refuse a seeded or retried
    // picture that is perfectly readable.
    expect(sent.length).toBe(1);
    expect(sent[0].attachments.map((a) => a.id)).toEqual(['i']);
  });

  test('a dispatched send reports onSent, which is what collapses the stretch', async () => {
    await mountPipeline();
    value = 'collapse me';
    await act(async () => { render(h(PipelineProbe, {}), container); });
    await act(async () => { api.submit(); });
    await waitFor(() => sent.length === 1);
    // `onSent` runs immediately BEFORE the dispatch, so the composer is already
    // docked when the optimistic row lands.
    expect(sentHooks).toBe(1);
  });

  test('a refused send reports nothing, so a stretched composer stays stretched', async () => {
    // The desktop bug this pins: the collapse used to happen in the click
    // handler, so a press that dispatched NOTHING (here: an attachment whose
    // read produced no body) shrank the box over content that was never sent.
    await mountPipeline();
    await act(async () => { api.acceptFiles([new File([], 'empty.md', { type: 'text/markdown' })]); });
    await waitFor(() => api.notice !== null);
    await act(async () => { api.submit(); });
    await settle();

    expect(sent).toEqual([]);
    expect(sentHooks).toBe(0);
  });

  test('an empty composer reports nothing either', async () => {
    await mountPipeline();
    await act(async () => { api.submit(); });
    await settle();
    expect(sentHooks).toBe(0);
  });

  test('a second click during the send does not dispatch the batch twice', async () => {
    await mountPipeline();
    await act(async () => {
      api.acceptFiles([textFile('a.md', 'a')]);
      api.submit();
      api.submit();
    });
    await waitFor(() => sent.length === 1);
    await settle(2);
    expect(sent.length).toBe(1);
  });

  test('a batch refused by the inline budget is reported, not attached', async () => {
    await mountPipeline();
    await act(async () => { api.acceptFiles(Array.from({ length: 10 }, (_, i) => textFile(`f${i}.md`, 'x'))); });
    await waitFor(() => current.length === 10);
    await act(async () => { api.acceptFiles([textFile('eleventh.md', 'x')]); });
    await waitFor(() => api.notice !== null);

    expect(api.notice).toBe('"eleventh.md" was not attached — inline limit is 10 text files / 256 KB total.');
    expect(current.length).toBe(10);
  });

  test('a drop cut short by the cap says so, and the notice can be dismissed', async () => {
    await mountPipeline();
    await act(async () => { api.acceptFiles([textFile('a.md', 'a')], true); });
    await waitFor(() => api.notice !== null);
    expect(api.notice).toBe(DROP_LIMIT_NOTICE);

    await act(async () => { api.dismissNotice(); });
    expect(api.notice).toBeNull();
  });

  test('a dropped reference is resolved through the server and attached as text', async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({ content: 'remote body', name: 'notes.md' }) });
    await mountPipeline();

    await act(async () => { api.acceptFiles([], false, ['https://web.example/notes.md']); });
    await waitFor(() => current.length === 1);

    expect(api.notice).toBeNull();
    expect(current.map((a) => [a.name, a.content])).toEqual([['notes.md', 'remote body']]);
  });

  test('a refused reference names the cause the user can act on', async () => {
    stubFetch({ ok: false, status: 403, json: async () => ({ error: 'remote downloads are not supported' }) });
    await mountPipeline();

    await act(async () => { api.acceptFiles([], false, ['https://web.example/notes.md']); });
    await waitFor(() => api.notice !== null);

    expect(api.notice).toBe('"notes.md" is a web download; save it into a workspace folder first (notes.md).');
  });

  test('removeAttachment drops one chip and leaves the rest', async () => {
    await mountPipeline();
    await act(async () => { api.acceptFiles([textFile('a.md', 'a'), textFile('b.md', 'b')]); });
    await waitFor(() => current.length === 2);
    const [first, second] = current;
    await act(async () => { api.removeAttachment(first.id); });
    expect(current.map((a) => a.id)).toEqual([second.id]);
  });

  test('a closed composer still exposes bound drag handlers', async () => {
    await mountPipeline();
    expect(api.isDragging).toBe(false);
    expect(typeof api.dropProps.onDrop).toBe('function');
  });

  /**
   * The overlay's state. The counter this replaced drifted upward on every child
   * crossing, so the card stayed lit after the pointer had left it.
   */
  test('child crossings keep the drop overlay lit, and one real exit clears it', async () => {
    await mountPipeline();
    const card = document.body.appendChild(document.createElement('div'));
    const child = card.appendChild(document.createElement('div'));
    const transfer = fileTransfer('file:///tmp/note.txt');
    const event = (related?: Node | null) => {
      const ev = new window.Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: transfer });
      Object.defineProperty(ev, 'currentTarget', { value: card });
      Object.defineProperty(ev, 'relatedTarget', { value: related ?? null });
      return ev as never;
    };

    await act(async () => { api.dropProps.onDragEnter(event()); });
    expect(api.isDragging).toBe(true);

    for (let pass = 0; pass < 5; pass += 1) {
      await act(async () => { api.dropProps.onDragOver(event()); });
      await act(async () => { api.dropProps.onDragLeave(event(child)); });
    }
    expect(api.isDragging).toBe(true);

    await act(async () => { api.dropProps.onDragLeave(event(null)); });
    expect(api.isDragging).toBe(false);
    card.remove();
  });
});
