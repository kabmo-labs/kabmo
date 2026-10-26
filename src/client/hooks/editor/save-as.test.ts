/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Save As: the name it suggests, the name it accepts, and what each answer means.
 *
 * The suggestion keeps the EXTENSION: a destination that lost it would be saved as a file
 * the surface no longer recognises, so the language would change under the user. A `409`
 * is a REFUSAL rather than a failure — the user picked a name that is taken — and the
 * dialog has to be able to say so without closing.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { isSingleSegmentName, saveAsSuggestedName, saveFileAs } from '@/client/hooks/editor/save-as';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

/**
 * The DOM globals come from the shared helper, and the `File`/`Blob` it installs are
 * RESTORED at the end.
 *
 * A local save-and-restore loop is what broke a suite two directories away: this file
 * swapped `File` and `Blob` for happy-dom's and never put them back, so a later file's
 * `carriesBytes` read a happy-dom `File` whose `slice().arrayBuffer()` answered empty and
 * reported that a real file held no bytes — a failure in a suite this file does not name.
 * `installDomGlobals`/`restoreDomGlobals` capture the runner's own values at their first
 * install and put them back, which is the only ordering-safe way to do it in a directory
 * run (Bun imports every file before any test executes).
 */
const nativeFetch = Bun.fetch;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterAll(() => {
  restoreDomGlobals();
});

afterEach(() => {
  globalThis.fetch = nativeFetch;
});

function stub(answer: { ok: boolean; status?: number; body?: unknown }): FormData[] {
  const forms: FormData[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    forms.push(init?.body as FormData);
    return {
      ok: answer.ok,
      status: answer.status ?? (answer.ok ? 200 : 500),
      json: async () => answer.body ?? null,
    };
  }) as unknown as typeof fetch;
  return forms;
}

describe('saveAsSuggestedName', () => {
  test('keeps the extension', () => {
    expect(saveAsSuggestedName('notes.ts')).toBe('notes copy.ts');
    expect(saveAsSuggestedName('README.md')).toBe('README copy.md');
  });

  test('a name with several dots keeps only the last as the extension', () => {
    expect(saveAsSuggestedName('a.test.ts')).toBe('a.test copy.ts');
  });

  test('a name with no extension gains none', () => {
    expect(saveAsSuggestedName('Makefile')).toBe('Makefile copy');
  });

  test('a dotfile is not treated as an extension', () => {
    // `.gitignore` has no stem to keep, so appending is the only sensible answer.
    expect(saveAsSuggestedName('.gitignore')).toBe('.gitignore copy');
  });
});

describe('isSingleSegmentName', () => {
  test('accepts a plain name', () => {
    expect(isSingleSegmentName('notes.ts')).toBe(true);
    expect(isSingleSegmentName('  notes.ts  ')).toBe(true);
  });

  test('refuses a separator, an empty name, and the two dot segments', () => {
    expect(isSingleSegmentName('a/b.ts')).toBe(false);
    expect(isSingleSegmentName('a\\b.ts')).toBe(false);
    expect(isSingleSegmentName('')).toBe(false);
    expect(isSingleSegmentName('   ')).toBe(false);
    expect(isSingleSegmentName('.')).toBe(false);
    expect(isSingleSegmentName('..')).toBe(false);
  });
});

describe('saveFileAs', () => {
  test('posts the directory, the name and the buffer, and answers the new path', async () => {
    const forms = stub({ ok: true, body: { success: true, path: 'src/notes copy.ts' } });
    const outcome = await saveFileAs({
      parent: 'src',
      name: 'notes copy.ts',
      content: 'const a = 1;\n',
      eol: 'lf',
      root: '/ws',
    });
    expect(outcome).toEqual({ status: 'written', path: 'src/notes copy.ts' });
    expect(forms[0].get('actionType')).toBe('saveAs');
    expect(forms[0].get('path')).toBe('src');
    expect(forms[0].get('name')).toBe('notes copy.ts');
    expect(forms[0].get('content')).toBe('const a = 1;\n');
    expect(forms[0].get('eol')).toBe('lf');
    expect(forms[0].get('root')).toBe('/ws');
  });

  test('no baseMtime is sent — a new file has nothing to compare against', async () => {
    const forms = stub({ ok: true, body: { success: true, path: 'a.ts' } });
    await saveFileAs({ parent: '', name: 'a.ts', content: 'x', eol: 'lf' });
    expect(forms[0].get('baseMtime')).toBeNull();
  });

  test('an empty name is refused before the request', async () => {
    const forms = stub({ ok: true, body: { success: true, path: 'x' } });
    expect(await saveFileAs({ parent: '', name: '   ', content: 'x', eol: 'lf' })).toEqual({
      status: 'failed',
      reason: 'Enter a file name.',
    });
    expect(forms).toHaveLength(0);
  });

  test('a 409 is an EXISTS refusal carrying the server sentence, not a failure', async () => {
    stub({ ok: false, status: 409, body: { error: 'notes.ts already exists' } });
    expect(await saveFileAs({ parent: 'src', name: 'notes.ts', content: 'x', eol: 'lf' })).toEqual({
      status: 'exists',
      reason: 'notes.ts already exists',
    });
  });

  test('a 409 with no body still names the name it collided with', async () => {
    stub({ ok: false, status: 409, body: null });
    const outcome = await saveFileAs({ parent: '', name: 'a.ts', content: 'x', eol: 'lf' });
    expect(outcome.status).toBe('exists');
    expect(outcome.status === 'exists' && outcome.reason).toContain('a.ts');
  });

  test('any other refusal is a failure with the server reason', async () => {
    stub({ ok: false, status: 403, body: { error: 'Invalid path' } });
    expect(await saveFileAs({ parent: '../x', name: 'a.ts', content: 'x', eol: 'lf' })).toEqual({
      status: 'failed',
      reason: 'Invalid path',
    });

    globalThis.fetch = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const dropped = await saveFileAs({ parent: '', name: 'a.ts', content: 'x', eol: 'lf' });
    expect(dropped.status).toBe('failed');
  });
});
