/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The page's half of an OS file launch.
 *
 * Three shells hand paths over (`__kabmoOpenPaths`), and the rules that fail
 * silently are all about TIMING: a launch that beats hydration must still open
 * its tab, and a shell that delivers the same batch twice must open one tab per
 * file rather than two.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import {
  OPEN_PATHS_PROPERTY,
  deliverOpenPaths,
  drainPendingOpenPaths,
  installOpenPaths,
  onOpenPaths,
  openPathsNow,
} from '@/client/lib/native/open-paths';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'CustomEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let responses: { status: number; body: unknown }[] = [];
let opened: unknown[] = [];

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  globalThis.fetch = (async () => {
    const next = responses.shift() ?? { status: 500, body: {} };
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
  }) as unknown as typeof globalThis.fetch;
  // The tab-opening half is a window event; recording it here proves a file was
  // handed to the editor rather than merely resolved.
  win.addEventListener('omp:open-file', (event) => {
    opened.push((event as unknown as CustomEvent).detail);
  });
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

beforeEach(() => {
  responses = [];
  opened = [];
});

describe('openPathsNow', () => {
  test('a resolved file opens a tab with its scope', async () => {
    responses = [{ status: 200, body: { root: '/w', path: 'a/b.md', name: 'b.md', kind: 'text' } }];
    const outcome = await openPathsNow(['/w/a/b.md']);
    expect(outcome).toEqual({ opened: ['/w/a/b.md'], refused: [] });
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ path: 'a/b.md', name: 'b.md', root: '/w' });
  });

  test('a refusal is reported and opens nothing', async () => {
    responses = [{ status: 404, body: { error: 'File not found' } }];
    const outcome = await openPathsNow(['/w/gone.md']);
    expect(outcome.opened).toEqual([]);
    expect(outcome.refused).toEqual([{ path: '/w/gone.md', reason: 'File not found' }]);
    expect(opened).toHaveLength(0);
  });

  test('a batch keeps its order and skips blanks', async () => {
    responses = [
      { status: 200, body: { root: '/w', path: 'a.md', name: 'a.md' } },
      { status: 200, body: { root: '/w', path: 'b.md', name: 'b.md' } },
    ];
    const outcome = await openPathsNow(['  ', '/w/a.md', '/w/b.md']);
    expect(outcome.opened).toEqual(['/w/a.md', '/w/b.md']);
  });
});

describe('delivery', () => {
  test('a path that arrives before a listener waits, and is drained once', () => {
    deliverOpenPaths(['/w/early.md']);
    const drained = drainPendingOpenPaths();
    expect(drained).toEqual(['/w/early.md']);
    // The queue is empty afterwards: a second drain must not reopen the file on
    // the next navigation.
    expect(drainPendingOpenPaths()).toEqual([]);
  });

  test('a duplicate arrival is held once', () => {
    deliverOpenPaths(['/w/x.md']);
    deliverOpenPaths(['/w/x.md']);
    expect(drainPendingOpenPaths()).toEqual(['/w/x.md']);
  });

  test('a listener takes what was already waiting', async () => {
    deliverOpenPaths(['/w/queued.md']);
    responses = [{ status: 200, body: { root: '/w', path: 'queued.md', name: 'queued.md' } }];
    const seen: string[][] = [];
    const off = onOpenPaths(async (paths) => {
      seen.push(paths);
      return { opened: paths, refused: [] };
    });
    // The handler runs on registration, so a launch that beat the listener is
    // not lost.
    await Promise.resolve();
    expect(seen).toEqual([['/w/queued.md']]);
    off();
  });

  test('the global the shell calls is installed, and refuses a non-array', () => {
    installOpenPaths({ onResult: () => {} });
    const call = (globalThis.window as unknown as Record<string, unknown>)[OPEN_PATHS_PROPERTY];
    expect(typeof call).toBe('function');
    // A shell too old to send an array must not throw inside the page.
    (call as (value: unknown) => void)('not an array');
  });

  test('the installed global routes a batch through the tab opener', async () => {
    // The handler the install registers is what a shell's call reaches, so
    // awaiting IT is the condition — no clock involved.
    const done = Promise.withResolvers<unknown>();
    installOpenPaths({ onResult: () => done.resolve(undefined) });
    responses = [{ status: 200, body: { root: '/w', path: 'from-shell.md', name: 'from-shell.md' } }];
    const call = (globalThis.window as unknown as Record<string, unknown>)[OPEN_PATHS_PROPERTY] as (value: unknown) => void;
    call(['/w/from-shell.md']);
    await done.promise;
    expect(opened.some((entry) => (entry as { name?: string }).name === 'from-shell.md')).toBe(true);
  });
});
