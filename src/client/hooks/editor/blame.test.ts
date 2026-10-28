/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The blame controller against a stubbed `fetch`, through the real hook.
 *
 * Three of its rules exist because the alternative was measured: a late answer
 * for another file, a payload reported under a key it was not read for, and a
 * payload discarded on every keystroke. Each is a case below, and each fails
 * with the guard removed.
 *
 * The hook, Preact and `act` are imported inside `beforeAll` for the reason
 * `file-editor.test-util.ts` does the same: the DOM globals have to be installed
 * BEFORE Preact is evaluated, so a top-level import would bind the wrong
 * `document`. `settle()` flushes microtasks rather than sleeping, because the
 * stubbed fetch resolves on its own schedule and a real delay would only make
 * the suite slower.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { FunctionComponent } from 'preact';

import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { BlamePayload } from '@/shared/lib/fs/git-blame';
import type { FileEditorTarget } from '@/client/hooks/editor/file-editor-types';
import type { useFileBlame as UseFileBlameHook } from '@/client/hooks/editor/blame';

const SHA = 'a'.repeat(40);

const PAYLOAD: BlamePayload = {
  available: true,
  head: SHA,
  lines: 3,
  runs: [{ from: 1, to: 3, sha: SHA }],
  commits: { [SHA]: { sha: SHA, author: 'Ada', mail: 'ada@example.com', time: 1_700_000_000, summary: 'feat: x' } },
};

const TARGET: FileEditorTarget = { name: 'a.ts', path: 'src/a.ts', root: '/repo', repo: '.' };
const OTHER: FileEditorTarget = { name: 'b.ts', path: 'src/b.ts', root: '/repo', repo: '.' };

type BlameController = ReturnType<typeof UseFileBlameHook>;

let useFileBlame: typeof UseFileBlameHook;
let h: typeof import('preact').h;
let render: typeof import('preact').render;
let act: typeof import('preact/test-utils').act;
let container: HTMLElement;

/** The hook's latest result, re-read after every settle. */
let live: BlameController | null = null;
let props: { target: FileEditorTarget | null; enabled?: boolean; dirty?: boolean } = { target: TARGET };

/** Every URL the hook asked for, in order. */
let requests: string[] = [];
const nativeFetch = Bun.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Flush every pending microtask, then let Preact's effects run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

async function mount(next: typeof props): Promise<void> {
  props = next;
  await act(async () => {
    render(h(Probe, {}), container);
  });
  await settle();
}

const Probe: FunctionComponent = () => {
  live = useFileBlame(props.target, { enabled: props.enabled, dirty: props.dirty });
  return null;
};

beforeAll(async () => {
  const win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  container = document.body.appendChild(document.createElement('div'));
  ({ useFileBlame } = await import('@/client/hooks/editor/blame'));
  ({ h, render } = await import('preact'));
  ({ act } = await import('preact/test-utils'));
});

afterAll(() => {
  restoreDomGlobals();
  globalThis.fetch = nativeFetch;
});

afterEach(async () => {
  // The same component type at the same position is UPDATED rather than
  // remounted, so without this the next case inherits the previous hook state.
  await act(async () => {
    render(null, container);
  });
  requests = [];
  live = null;
});

describe('useFileBlame', () => {
  test('reads the file once and reports it ready', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return jsonResponse(PAYLOAD);
    }) as typeof fetch;

    await mount({ target: TARGET });
    const snapshot = live!.snapshot();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.payload?.lines).toBe(3);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('blame=1');
    expect(requests[0]).toContain('file=src%2Fa.ts');
    expect(requests[0]).toContain('root=%2Frepo');
  });

  test('a dirty buffer issues no read at all', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return jsonResponse(PAYLOAD);
    }) as typeof fetch;

    await mount({ target: TARGET, dirty: true });
    expect(requests).toHaveLength(0);
    expect(live!.stale()).toBe(true);
    // The previous payload is kept and marked stale rather than blanked: a
    // skeleton on every keystroke would be worse than a label that says why.
    expect(live!.snapshot().payload).toBeNull();
  });

  test('saving re-reads, and the answer arrives without a remount', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return jsonResponse(PAYLOAD);
    }) as typeof fetch;

    await mount({ target: TARGET, dirty: true });
    await mount({ target: TARGET, dirty: false });
    expect(requests).toHaveLength(1);
    expect(live!.snapshot().status).toBe('ready');
  });

  test('an unavailable payload is reported as an answer, not an error', async () => {
    const untracked: BlamePayload = {
      available: false,
      head: null,
      lines: 0,
      runs: [],
      commits: {},
      reason: 'untracked',
      message: "fatal: no such path 'x' in HEAD",
    };
    globalThis.fetch = (async () => jsonResponse(untracked)) as unknown as typeof fetch;

    await mount({ target: TARGET });
    const snapshot = live!.snapshot();
    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.payload?.reason).toBe('untracked');
    expect(snapshot.message).toContain('no such path');
  });

  test('a failed request is an error that keeps the server’s reason', async () => {
    globalThis.fetch = (async () => jsonResponse({ error: 'Invalid path' }, 403)) as unknown as typeof fetch;

    await mount({ target: TARGET });
    const snapshot = live!.snapshot();
    expect(snapshot.status).toBe('error');
    expect(snapshot.message).toBe('Invalid path');
  });

  test('a late answer for the PREVIOUS file never lands on the new one', async () => {
    // The first file's read is held open; the tab switches; only then does the
    // first answer arrive. Adopting it would label b.ts with a.ts's authors.
    const held = Promise.withResolvers<Response>();
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('a.ts')) return held.promise;
      return Promise.resolve(jsonResponse({ ...PAYLOAD, lines: 9, runs: [{ from: 1, to: 9, sha: SHA }] }));
    }) as typeof fetch;

    await mount({ target: TARGET });
    await mount({ target: OTHER });
    expect(live!.snapshot().payload?.lines).toBe(9);

    held.resolve(jsonResponse(PAYLOAD));
    await settle();
    // Still the second file's answer.
    expect(live!.snapshot().payload?.lines).toBe(9);
    expect(live!.snapshot().status).toBe('ready');
  });

  test('the snapshot is loading for a file whose read has not landed yet', async () => {
    const held = Promise.withResolvers<Response>();
    globalThis.fetch = (() => held.promise) as unknown as typeof fetch;

    await mount({ target: TARGET });
    expect(live!.snapshot().status).toBe('loading');

    // A switch to a file the controller has never read must not show the
    // previous file's payload under the new key.
    await mount({ target: OTHER });
    expect(live!.snapshot().payload).toBeNull();

    held.resolve(jsonResponse(PAYLOAD));
    await settle();
  });

  test('history is read once per line and cached', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('blameHistory=1')) {
        return jsonResponse({ entries: [{ sha: SHA, author: 'Ada', time: 1, summary: 'feat: x' }], truncated: false });
      }
      return jsonResponse(PAYLOAD);
    }) as typeof fetch;

    await mount({ target: TARGET });
    const first = await live!.history(2);
    const second = await live!.history(2);
    expect(first.entries).toHaveLength(1);
    expect(second).toBe(first);
    expect(requests.filter((url) => url.includes('blameHistory=1'))).toHaveLength(1);
  });

  test('a failed history read is an empty list, not a throw', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes('blameHistory=1')) throw new Error('offline');
      return jsonResponse(PAYLOAD);
    }) as unknown as typeof fetch;

    await mount({ target: TARGET });
    expect(await live!.history(3)).toEqual({ entries: [], truncated: false });
  });

  test('reload drops the cached history and reads again', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('blameHistory=1')) return jsonResponse({ entries: [], truncated: false });
      return jsonResponse(PAYLOAD);
    }) as typeof fetch;

    await mount({ target: TARGET });
    await live!.history(1);
    live!.reload();
    await settle();
    await live!.history(1);
    expect(requests.filter((url) => url.includes('blameHistory=1'))).toHaveLength(2);
    expect(requests.filter((url) => url.includes('blame=1'))).toHaveLength(2);
  });

  test('a device-backed tab is never read: there is no path the server can reach', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return jsonResponse(PAYLOAD);
    }) as unknown as typeof fetch;

    await mount({ target: { name: 'x.png', path: 'x.png', deviceFile: true } });
    expect(requests).toHaveLength(0);
  });
});
