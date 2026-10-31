/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor's "this file is gone" decoration.
 *
 * Two rules are asserted, and both were bugs waiting to happen:
 *
 * 1. **A probe that cannot answer does not strike the tab through.** A refused
 *    request, a non-JSON body or a dropped connection says nothing about the
 *    file; reporting it as missing would redden a tab over a network blip.
 * 2. **A tab is probed in the tree it was opened from.** The same relative path
 *    in two workspaces is two different files, so a verdict for one must never
 *    reach the other — the probe's `root`/`repo` fields are what keep them
 *    apart.
 *
 * Rendered with `h()` against happy-dom, the hook imported DYNAMICALLY after
 * those globals exist (Preact binds its environment at evaluation time).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import type { OpenTabScope, ProbeableTab, useMissingFiles as UseMissingFilesHook } from '@/client/hooks/workspace/missing-files';

let useMissingFiles: typeof UseMissingFilesHook;
let openTabScopeKey: (tab: OpenTabScope) => string;
let h: typeof PreactH;
let render: typeof PreactRender;
let act: typeof PreactAct;

let mounted: Set<number | string> | null = null;
let container: HTMLElement;

/** Every probe the hook issued, as its query params. */
let probes: Array<{ path: string; root: string | null; repo: string | null }>;
/** The paths the stubbed disk reports as present, keyed `repo\0path`. */
let present: Set<string>;
/** When true, every probe answers a non-JSON 500 — a transport failure. */
let transportFailure: boolean;

const nativeFetch = Bun.fetch;

function stubFetch() {
  globalThis.fetch = (async (input: unknown) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.searchParams.get('path') ?? '';
    const repo = url.searchParams.get('repo') ?? '.';
    probes.push({ path, root: url.searchParams.get('root'), repo });
    if (transportFailure) return new Response('gateway blew up', { status: 500 });
    return new Response(JSON.stringify({ exists: present.has(`${repo}\u0000${path}`) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    });
  }
}

async function mount(tabs: ProbeableTab[], refreshKey = 0) {
  const Probe = ({ tabs: current, refreshKey: key }: { tabs: ProbeableTab[]; refreshKey: number }) => {
    mounted = useMissingFiles(current, key);
    return null;
  };
  await act(async () => {
    render(h(Probe, { tabs, refreshKey }), container);
  });
  await settle();
}

const installed: Record<string, unknown> = {};
const displaced: Record<string, unknown> = {};
beforeAll(async () => {
  const win = new Window({ url: 'http://localhost' });
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement'] as const) {
    displaced[key] = (globalThis as Record<string, unknown>)[key];
    installed[key] = (win as unknown as Record<string, unknown>)[key];
    (globalThis as Record<string, unknown>)[key] = installed[key];
  }
  ({ useMissingFiles, openTabScopeKey } = await import('@/client/hooks/workspace/missing-files'));
  ({ h, render } = await import('preact'));
  ({ act } = await import('preact/test-utils'));
});

afterAll(() => {
  globalThis.fetch = nativeFetch;
  for (const key of Object.keys(installed)) {
    if (displaced[key] === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = displaced[key];
  }
});

beforeEach(() => {
  mounted = null;
  probes = [];
  present = new Set();
  transportFailure = false;
  stubFetch();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

describe('useMissingFiles', () => {
  test('a tab whose file is gone is reported, one whose file is there is not', async () => {
    present = new Set(['.\u0000src/keep.ts']);
    await mount([
      { id: 1, path: 'src/keep.ts', root: '/ws', repo: '.' },
      { id: 2, path: 'src/gone.ts', root: '/ws', repo: '.' },
    ]);

    expect([...(mounted ?? [])]).toEqual([2]);
  });

  test('a transport failure is NOT a verdict', async () => {
    // Nothing is on the fake disk, so a probe that trusted its own failure
    // would report both tabs as missing over a 500.
    transportFailure = true;
    await mount([{ id: 1, path: 'src/a.ts', root: '/ws', repo: '.' }]);

    expect([...(mounted ?? [])]).toEqual([]);
  });

  test('a tab with no path (an attachment chip) is never probed', async () => {
    await mount([{ id: 1, name: 'notes' } as OpenTabScope]);

    expect(probes).toEqual([]);
    expect([...(mounted ?? [])]).toEqual([]);
  });

  test('the probe carries the tree the tab was opened from', async () => {
    present = new Set(['projects/a\u0000src/x.ts']);
    await mount([
      { id: 'a', path: 'src/x.ts', root: '/ws', repo: 'projects/a' },
      { id: 'b', path: 'src/x.ts', root: '/ws', repo: 'projects/b' },
    ]);

    const forRepoA = probes.find((p) => p.repo === 'projects/a');
    expect(forRepoA).toEqual({ path: 'src/x.ts', root: '/ws', repo: 'projects/a' });
    // The same path under another repo is a DIFFERENT file, and its own probe
    // answered for it: only the repo that actually holds it is present.
    expect([...(mounted ?? [])]).toEqual(['b']);
  });

  test('a workspace refresh re-probes, so a file deleted afterwards is noticed', async () => {
    present = new Set(['.\u0000src/a.ts']);
    await mount([{ id: 1, path: 'src/a.ts', root: '/ws', repo: '.' }]);
    expect([...(mounted ?? [])]).toEqual([]);

    // Deleted outside the panel: the only signal is the refresh the delete
    // path raises (a Files-panel delete, a save, the panel's own Refresh).
    present = new Set();
    await mount([{ id: 1, path: 'src/a.ts', root: '/ws', repo: '.' }], 1);

    expect([...(mounted ?? [])]).toEqual([1]);
  });

  test('a tab with no server-backed file is never probed', async () => {
    // Measured on a phone: opening an attachment chip, a launched document or a
    // file in a nested repo struck it through as deleted, because the caller
    // filtered these itself and the phone's caller forgot. The rule now lives in
    // `isProbeableTab`, so this asserts the SKIP for every such tab.
    await mount([
      { id: 'chip', path: 'notes.md', content: '# inline' },
      { id: 'handle', path: 'launched.md', handleId: 'handle-1' },
      { id: 'device', path: 'report.md', deviceFile: true },
      { id: 'diff', path: 'src/a.ts', isDiff: true },
      { id: 'plain', path: 'src/a.ts' },
    ]);

    expect(probes.map((p) => p.path)).toEqual(['src/a.ts']);
    expect([...(mounted ?? [])]).toEqual(['plain']);
  });

  test('the scope key keeps two trees apart', () => {
    expect(openTabScopeKey({ id: 1, path: 'a.ts', root: '/ws', repo: '.' })).not.toBe(
      openTabScopeKey({ id: 1, path: 'a.ts', root: '/ws', repo: 'projects/b' }),
    );
    expect(openTabScopeKey({ id: 1, path: 'a.ts', root: '/ws', repo: '.' })).toBe(
      openTabScopeKey({ id: 9, path: 'a.ts', root: '/ws', repo: '.' }),
    );
  });
});
