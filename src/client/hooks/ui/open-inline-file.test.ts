/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The click half of a file chip: open, resolve, or ask.
 *
 * A bare filename is the case with three honest outcomes, and this suite pins
 * each one against the real `openFileInEditor` event and the real palette
 * store — a test that only asserted an internal return value would pass while
 * neither surface moved.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { closePalette, paletteState } from '@/client/lib/commands/overlays';
import { setPluginContext } from '@/client/lib/plugins/context';
import { getLineReveal, setLineReveal } from '@/client/lib/line-reveal';
import {
  activateInlineFileChip,
  openInlineFileReference,
  readInlineFileChip,
} from '@/client/hooks/ui/open-inline-file';

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'Event', 'CustomEvent', 'fetch',
] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

const ROOT = '/repo';
let files: Array<{ path: string }> = [];
let fetchCalls: string[] = [];
let opened: Array<{ path: string; root?: string }> = [];

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  globalThis.fetch = (async (url: string) => {
    fetchCalls.push(String(url));
    return { ok: true, json: async () => ({ files, truncated: false }) };
  }) as unknown as typeof globalThis.fetch;
  win.addEventListener('omp:open-file', (event) => {
    opened.push((event as unknown as CustomEvent<{ path: string; root?: string }>).detail);
  });
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

afterEach(() => {
  closePalette();
  setLineReveal(null);
  setPluginContext(null, null);
  files = [];
  fetchCalls = [];
  opened = [];
});

describe('openInlineFileReference', () => {
  test('a path with a directory opens immediately, with its line published first', async () => {
    setPluginContext(null, ROOT);
    await openInlineFileReference({ path: 'src/a.ts', line: 12 });

    expect(fetchCalls).toEqual([]);
    expect(getLineReveal()).toEqual({ path: 'src/a.ts', line: 12 });
    expect(opened.map((file) => file.path)).toEqual(['src/a.ts']);
    expect(opened[0].root).toBe(ROOT);
  });

  test('a bare filename with one match opens the path it lives at', async () => {
    setPluginContext(null, ROOT);
    files = [{ path: 'src/client/App.tsx' }, { path: 'src/server/read.ts' }];
    await openInlineFileReference({ path: 'App.tsx', line: 3 });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toContain('/api/fs/list');
    expect(fetchCalls[0]).toContain(encodeURIComponent(ROOT));
    expect(getLineReveal()).toEqual({ path: 'src/client/App.tsx', line: 3 });
    expect(opened.map((file) => file.path)).toEqual(['src/client/App.tsx']);
  });

  test('a bare filename with several matches opens the picker on the name', async () => {
    setPluginContext(null, ROOT);
    files = [{ path: 'src/a/index.ts' }, { path: 'src/b/index.ts' }];
    await openInlineFileReference({ path: 'index.ts' });

    expect(opened).toEqual([]);
    expect(paletteState().open).toBe(true);
    expect(paletteState().mode).toBe('files');
    expect(paletteState().query).toBe('index.ts');
  });

  test('a bare filename with no match opens as written, so the editor reports it', async () => {
    setPluginContext(null, ROOT);
    await openInlineFileReference({ path: 'Missing.tsx' });

    expect(opened.map((file) => file.path)).toEqual(['Missing.tsx']);
    expect(paletteState().open).toBe(false);
  });

  test('without a workspace the index is not asked and the reference opens as written', async () => {
    await openInlineFileReference({ path: 'App.tsx' });

    expect(fetchCalls).toEqual([]);
    expect(opened.map((file) => file.path)).toEqual(['App.tsx']);
  });
});

describe('chip attributes', () => {
  test('a marked chip opens the file it names', async () => {
    setPluginContext(null, ROOT);
    const chip = document.createElement('code');
    chip.setAttribute('data-file-path', 'src/a.ts');
    chip.setAttribute('data-file-line', '9');

    expect(readInlineFileChip(chip)).toEqual({ path: 'src/a.ts', line: 9 });
    activateInlineFileChip(chip);
    await Promise.resolve();

    expect(opened.map((file) => file.path)).toEqual(['src/a.ts']);
    expect(getLineReveal()).toEqual({ path: 'src/a.ts', line: 9 });
  });

  test('a chip with no path and a zero line are both ignored', () => {
    const empty = document.createElement('code');
    expect(readInlineFileChip(empty)).toBeNull();

    const zero = document.createElement('code');
    zero.setAttribute('data-file-path', 'src/a.ts');
    zero.setAttribute('data-file-line', '0');
    expect(readInlineFileChip(zero)).toEqual({ path: 'src/a.ts' });
  });
});
