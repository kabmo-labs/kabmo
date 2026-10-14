/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor's font setting, its browser file actions, and the write half of
 * the file-editing contract.
 *
 * The font cases pin the two rules that make the picker safe to offer faces the
 * app does not ship: the stored family goes FIRST in the stack with the bundled
 * Fira Code still behind it, and a live change reaches an already-mounted editor
 * through the window event rather than a prop captured at boot.
 *
 * The file-action cases pin the request each path makes — a download anchor for
 * `saveBlob`, a fetch for an image's bytes — because the two paths must not
 * drift apart, and the failure of either is the caller's only signal.
 *
 * The save cases pin the multipart shape the server rebuilds the file from,
 * including the line ending that travels as its own field, and the rule that
 * EVERY refusal is `false`: the caller's only decision is whether to mark the
 * buffer clean.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import {
  EDITOR_FONT_CHANGED_EVENT,
  currentEditorFont,
  useEditorFontStack,
} from '@/client/hooks/editor/font';
import { copyImageToClipboard, downloadUrl, saveBlob } from '@/client/hooks/editor/file-actions';
import { retainKeys, saveEditorFile } from '@/client/hooks/editor/save-file';
import { EDITOR_DEFAULT_FONT_FAMILY, EDITOR_FONT_FAMILY } from '@/shared/lib/code/editor/typography';
import { primeChamberSettings } from '@/shared/lib/settings/client';

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent',
  'getComputedStyle', 'File', 'Blob', 'FormData', 'URL', 'ClipboardItem', 'HTMLAnchorElement',
] as const;

/** The runner's own fetch, restored after every test that stubs one. */
/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const nativeFetch = Bun.fetch;
/** Set by a stub so a test can read the Blob handed to the download anchor. */
let lastBlob: Blob | null = null;
/** URLs handed to `createObjectURL`, and the ones revoked. */
let created: string[] = [];
let revoked: string[] = [];
/** The anchor the download path actually clicked. */
let clicked: { href: string; download: string }[] = [];

/** The runner's own globals, put back once this file's DOM work is done. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  nativeClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  nativeClipboardItem = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    lastBlob = blob as Blob;
    const url = `blob:test/${created.length + 1}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => { revoked.push(url); };
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download });
  };
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
  lastBlob = null;
  created = [];
  revoked = [];
  clicked = [];
});

/** Clipboard descriptors, captured while the happy-dom window is installed and
 *  put back after every case: the three `copyImageToClipboard` cases each
 *  replace one, and a leftover `undefined` would strand the next one. */
let nativeClipboard: PropertyDescriptor | undefined;
let nativeClipboardItem: PropertyDescriptor | undefined;

afterEach(() => {
  if (nativeClipboard) Object.defineProperty(navigator, 'clipboard', nativeClipboard);
  if (nativeClipboardItem) Object.defineProperty(globalThis, 'ClipboardItem', nativeClipboardItem);
});

// ── font.ts ─────────────────────────────────────────────────────────────────

let container: HTMLElement;
let stack = '';

function FontProbe() {
  stack = useEditorFontStack();
  return null;
}

async function mountFont(): Promise<HTMLElement> {
  container = document.body.appendChild(document.createElement('div'));
  await act(async () => { render(h(FontProbe, {}), container); });
  return container;
}

describe('the editor font setting', () => {
  test('an unset setting resolves to the shipped default family', () => {
    primeChamberSettings({});
    expect(currentEditorFont()).toBe(EDITOR_DEFAULT_FONT_FAMILY);
    expect(EDITOR_FONT_FAMILY.startsWith(`"${EDITOR_DEFAULT_FONT_FAMILY}"`)).toBe(true);
  });

  test('a stored family is read from the settings snapshot', () => {
    primeChamberSettings({ editorFont: 'Menlo' });
    expect(currentEditorFont()).toBe('Menlo');
  });

  test('the mounted editor starts on the stored family, not the default', async () => {
    primeChamberSettings({ editorFont: 'Menlo' });
    await mountFont();
    expect(stack.startsWith('"Menlo",')).toBe(true);
    // The bundled stack stays behind the choice, which is what lets a device
    // without Menlo still render code in Fira Code.
    expect(stack).toContain(EDITOR_FONT_FAMILY);
  });

  test('a live change reaches the mounted editor and re-resolves the stack', async () => {
    primeChamberSettings({ editorFont: 'Menlo' });
    await mountFont();
    await act(async () => {
      window.dispatchEvent(new CustomEvent(EDITOR_FONT_CHANGED_EVENT, { detail: 'JetBrains Mono' }));
    });
    expect(stack.startsWith('"JetBrains Mono",')).toBe(true);

    // A detail-less event re-reads the setting rather than clearing the choice.
    await act(async () => {
      window.dispatchEvent(new CustomEvent(EDITOR_FONT_CHANGED_EVENT, { detail: '' }));
    });
    expect(stack.startsWith('"Menlo",')).toBe(true);
  });

  test('the listener is removed when the editor unmounts', async () => {
    primeChamberSettings({ editorFont: 'Menlo' });
    await mountFont();
    if (container) render(null, container);
    // No subscriber left: a write must not throw or touch a dead component.
    window.dispatchEvent(new CustomEvent(EDITOR_FONT_CHANGED_EVENT, { detail: 'Monaco' }));
    expect(stack.startsWith('"Menlo",')).toBe(true);
  });
});

// ── file-actions.ts ─────────────────────────────────────────────────────────

/** A canned fetch, recording the URL it was asked for. */
function stubFetch(answer: { ok: boolean; status: number; blob?: () => Promise<Blob> }): { urls: string[] } {
  const urls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    urls.push(String(input));
    return {
      ok: answer.ok,
      status: answer.status,
      blob: answer.blob ?? (async () => new Blob(['bytes'], { type: 'image/png' })),
    };
  }) as unknown as typeof fetch;
  return { urls };
}

describe('saveBlob', () => {
  test('hands the browser a download and releases the object URL again', () => {
    const blob = new Blob(['# hi'], { type: 'text/markdown' });
    saveBlob(blob, 'notes.md');

    expect(clicked).toEqual([{ href: 'blob:test/1', download: 'notes.md' }]);
    expect(revoked).toEqual(['blob:test/1']);
  });
});

describe('downloadUrl', () => {
  test('fetches the bytes and downloads them under the given name', async () => {
    const { urls } = stubFetch({ ok: true, status: 200 });
    await downloadUrl('/api/fs/raw?path=a.png', 'a.png');

    expect(urls).toEqual(['/api/fs/raw?path=a.png']);
    expect(lastBlob?.type).toBe('image/png');
    expect(clicked.map((c) => c.download)).toEqual(['a.png']);
  });

  test('a refused response throws instead of downloading an error page', async () => {
    stubFetch({ ok: false, status: 404 });
    await expect(downloadUrl('/api/fs/raw?path=gone.png', 'gone.png')).rejects.toThrow('HTTP 404');
    expect(clicked).toEqual([]);
  });
});

describe('copyImageToClipboard', () => {
  test('writes the picture itself, keyed by its MIME type', async () => {
    stubFetch({ ok: true, status: 200, blob: async () => new Blob(['PNG'], { type: 'image/png' }) });
    // A real `ClipboardItem` is inspected through its own API, not its
    // properties: happy-dom keeps the data in a private field and exposes
    // `types` / `getType`, so `Object.keys` would pin the implementation.
    const written: ClipboardItem[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: async (items: ClipboardItem[]) => { const [first] = items; if (first) written.push(first); } },
    });

    await copyImageToClipboard('/api/fs/raw?path=a.png');
    const [item] = written;
    if (!item) throw new Error('expected one clipboard item');
    expect(item.types).toEqual(['image/png']);
    expect(await item.getType('image/png')).toBeInstanceOf(Blob);
  });

  test('a refused response throws before anything reaches the clipboard', async () => {
    stubFetch({ ok: false, status: 500 });
    let wrote = false;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: async () => { wrote = true; } },
    });

    await expect(copyImageToClipboard('/api/fs/raw?path=a.png')).rejects.toThrow('HTTP 500');
    expect(wrote).toBe(false);
  });

  test('an unavailable clipboard API rejects rather than silently doing nothing', async () => {
    stubFetch({ ok: true, status: 200 });
    Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });

    await expect(copyImageToClipboard('/api/fs/raw?path=a.png')).rejects.toThrow('Image clipboard unavailable');
  });
});

// ── save-file.ts ────────────────────────────────────────────────────────────

interface Write {
  url: string;
  method: string;
  form: FormData;
}

/** Captures the write request and answers it with `answer`. */
function stubWrite(answer: { ok: boolean; body?: unknown; throwOnJson?: boolean }): Write[] {
  const writes: Write[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    writes.push({ url: String(input), method: init?.method ?? 'GET', form: init?.body as FormData });
    return {
      ok: answer.ok,
      json: async () => {
        if (answer.throwOnJson) throw new Error('not json');
        return answer.body ?? null;
      },
    };
  }) as unknown as typeof fetch;
  return writes;
}

describe('saveEditorFile', () => {
  test('posts the buffer with the path and the ending as its own field', async () => {
    const writes = stubWrite({ ok: true, body: { success: true } });
    const ok = await saveEditorFile({ path: 'src/a.ts', root: '/repo' }, 'const a = 1;\n', 'lf');

    expect(ok).toBe('written');
    expect(writes.length).toBe(1);
    expect(writes[0].url).toBe('/api/fs/action');
    expect(writes[0].method).toBe('POST');
    // A multipart body normalizes bare LF, so the ending cannot travel in it.
    expect(writes[0].form.get('actionType')).toBe('save');
    expect(writes[0].form.get('path')).toBe('src/a.ts');
    expect(writes[0].form.get('content')).toBe('const a = 1;\n');
    expect(writes[0].form.get('eol')).toBe('lf');
    expect(writes[0].form.get('root')).toBe('/repo');
  });

  test('omits the root when the file has none and the repo when it is the cwd marker', async () => {
    const writes = stubWrite({ ok: true, body: { success: true } });
    await saveEditorFile({ path: 'a.ts', repo: '.' }, 'x', 'crlf');
    expect(writes[0].form.get('root')).toBeNull();
    expect(writes[0].form.get('repo')).toBeNull();
  });

  test('a named repo travels with the write', async () => {
    const writes = stubWrite({ ok: true, body: { success: true } });
    await saveEditorFile({ path: 'a.ts', repo: 'other' }, 'x', 'crlf');
    expect(writes[0].form.get('repo')).toBe('other');
  });

  test('a file with no path is refused without touching the network', async () => {
    const writes = stubWrite({ ok: true, body: { success: true } });
    expect(await saveEditorFile({}, 'x', 'lf')).toBe('failed');
    expect(writes).toEqual([]);
  });

  test('every refusal reports failed: non-2xx, an error body, a non-JSON body, a dropped connection', async () => {
    stubWrite({ ok: false, body: { success: true } });
    expect(await saveEditorFile({ path: 'a.ts' }, 'x', 'lf')).toBe('failed');

    stubWrite({ ok: true, body: { success: false } });
    expect(await saveEditorFile({ path: 'a.ts' }, 'x', 'lf')).toBe('failed');

    stubWrite({ ok: true, body: null });
    expect(await saveEditorFile({ path: 'a.ts' }, 'x', 'lf')).toBe('failed');

    stubWrite({ ok: true, throwOnJson: true });
    expect(await saveEditorFile({ path: 'a.ts' }, 'x', 'lf')).toBe('failed');

    globalThis.fetch = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await saveEditorFile({ path: 'a.ts' }, 'x', 'lf')).toBe('failed');
  });
});

describe('retainKeys', () => {
  test('keeps the same object when nothing was dropped, so children keep their identity', () => {
    const record = { a: 1, b: 2 };
    expect(retainKeys(record, new Set(['a', 'b']))).toBe(record);
  });

  test('drops the keys that left the tab set and keeps the rest', () => {
    const record = { a: 1, b: 2, c: 3 };
    expect(retainKeys(record, new Set(['a', 'c']))).toEqual({ a: 1, c: 3 });
    expect(retainKeys(record, new Set())).toEqual({});
  });
});

