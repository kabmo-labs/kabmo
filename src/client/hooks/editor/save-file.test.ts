/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The write half of the file-editing contract.
 *
 * Two things are pinned here. The multipart shape the server rebuilds the file
 * from — including the line ending that travels as its own field, because a
 * multipart body normalizes bare LF — and the CONFLICT verdict, which is the only
 * answer that must not be reported as a failure: a `409` carries the disk's own
 * mtime so the panel can offer Reload/Keep instead of "save failed".
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { retainKeys, saveEditorFile } from '@/client/hooks/editor/save-file';

/** Globals happy-dom provides and the save path reads. */
const DOM_GLOBALS = ['window', 'document', 'navigator', 'FormData', 'File', 'Blob'] as const;

/** The runner's own `fetch`, reached through `Bun` so a leaked stub cannot be mistaken for it. */
const nativeFetch = Bun.fetch;
/** The runner's own globals, put back once this file's DOM work is done. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  const source = win as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    native[key] = target[key];
    target[key] = source[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) target[key] = native[key];
  globalThis.fetch = nativeFetch;
});

afterEach(() => {
  globalThis.fetch = nativeFetch;
});

interface Write {
  url: string;
  method: string;
  form: FormData;
}

/** Captures the write request and answers it with `answer`. */
function stubWrite(answer: { ok: boolean; status?: number; body?: unknown; throwOnJson?: boolean }): Write[] {
  const writes: Write[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    writes.push({ url: String(input), method: init?.method ?? 'GET', form: init?.body as FormData });
    return {
      ok: answer.ok,
      status: answer.status ?? (answer.ok ? 200 : 500),
      json: async () => {
        if (answer.throwOnJson) throw new Error('not json');
        return answer.body ?? null;
      },
    };
  }) as unknown as typeof fetch;
  return writes;
}

describe('saveEditorFile — the request it builds', () => {
  test('posts the buffer with the path and the ending as its own field', async () => {
    const writes = stubWrite({ ok: true, body: { success: true } });
    const outcome = await saveEditorFile({ path: 'src/a.ts', root: '/repo' }, 'const a = 1;\n', 'lf', { interactive: false });

    expect(outcome).toEqual({ status: 'written' });
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
    await saveEditorFile({ path: 'a.ts', repo: '.' }, 'x', 'crlf', { interactive: false });
    expect(writes[0].form.get('root')).toBeNull();
    expect(writes[0].form.get('repo')).toBeNull();
  });

  test('a named repo travels with the write', async () => {
    const writes = stubWrite({ ok: true, body: { success: true } });
    await saveEditorFile({ path: 'a.ts', repo: 'other' }, 'x', 'crlf', { interactive: false });
    expect(writes[0].form.get('repo')).toBe('other');
  });

  test('a file with no path is refused without touching the network', async () => {
    const writes = stubWrite({ ok: true, body: { success: true } });
    expect(await saveEditorFile({}, 'x', 'lf', { interactive: false })).toEqual({ status: 'failed' });
    expect(writes).toEqual([]);
  });
});

describe('saveEditorFile — the conflict contract', () => {
  test('the base mtime travels with the write when the caller has one', async () => {
    const writes = stubWrite({ ok: true, body: { success: true } });
    await saveEditorFile({ path: 'a.ts' }, 'x', 'lf', { interactive: false, baseMtimeMs: 1_700_000_000_123 });
    expect(writes[0].form.get('baseMtime')).toBe('1700000000123');
  });

  test('no base mtime sends no field — a handle write and an older client must still save', async () => {
    const writes = stubWrite({ ok: true, body: { success: true } });
    await saveEditorFile({ path: 'a.ts' }, 'x', 'lf', { interactive: false });
    expect(writes[0].form.get('baseMtime')).toBeNull();

    const again = stubWrite({ ok: true, body: { success: true } });
    await saveEditorFile({ path: 'a.ts' }, 'x', 'lf', { interactive: false, baseMtimeMs: null });
    // `null` must not become the string "null", which the server would parse and
    // then compare against a real mtime — failing every save.
    expect(again[0].form.get('baseMtime')).toBeNull();
  });

  test('a 409 is a CONFLICT with the disk mtime, never a failure', async () => {
    stubWrite({
      ok: false,
      status: 409,
      body: { error: 'This file changed on disk since it was opened.', conflict: true, mtimeMs: 1_700_000_000_999 },
    });
    expect(await saveEditorFile({ path: 'a.ts' }, 'x', 'lf', { interactive: false, baseMtimeMs: 1 })).toEqual({
      status: 'conflict',
      diskMtimeMs: 1_700_000_000_999,
    });
  });

  test('a 409 whose body names no mtime still reports a conflict, with null', async () => {
    stubWrite({ ok: false, status: 409, body: null });
    expect(await saveEditorFile({ path: 'a.ts' }, 'x', 'lf', { interactive: false, baseMtimeMs: 1 })).toEqual({
      status: 'conflict',
      diskMtimeMs: null,
    });
  });
});

describe('saveEditorFile — every other refusal is a failure', () => {
  test('non-2xx, an error body, a non-JSON body, a dropped connection', async () => {
    stubWrite({ ok: false, body: { success: true } });
    expect(await saveEditorFile({ path: 'a.ts' }, 'x', 'lf', { interactive: false })).toEqual({ status: 'failed' });

    stubWrite({ ok: true, body: { success: false } });
    expect(await saveEditorFile({ path: 'a.ts' }, 'x', 'lf', { interactive: false })).toEqual({ status: 'failed' });

    stubWrite({ ok: true, body: null });
    expect(await saveEditorFile({ path: 'a.ts' }, 'x', 'lf', { interactive: false })).toEqual({ status: 'failed' });

    stubWrite({ ok: true, throwOnJson: true });
    expect(await saveEditorFile({ path: 'a.ts' }, 'x', 'lf', { interactive: false })).toEqual({ status: 'failed' });

    globalThis.fetch = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await saveEditorFile({ path: 'a.ts' }, 'x', 'lf', { interactive: false })).toEqual({ status: 'failed' });
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
