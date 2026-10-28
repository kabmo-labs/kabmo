/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useFileClipboard` — the hook's own contract, mounted directly.
 *
 * The row specs hand the row a STUB, and the panel specs drive the stub through
 * the tree, so the hook itself is exercised nowhere else: what it posts, what it
 * refuses before posting, and when it clears the clipboard.
 *
 * Three rules, each a shape that fails silently:
 *
 * 1. **A refused move posts nothing.** The row's `dragover` gate already
 *    declines an illegal drop, which is what keeps the browser from drawing a
 *    drop cursor — but the gate and this check are two places the same rule
 *    lives, and only a direct caller proves the second one holds.
 * 2. **A cut clears the clipboard once its paste lands; a copy does not.** One
 *    entry pasting many times is what a copy is for, and a cut that stayed would
 *    paste a file that is no longer where it says.
 * 3. **The entry's SCOPE decides a paste, not the path.** The same relative path
 *    in another workspace names a different file, so the clipboard's origin is
 *    part of the entry.
 *
 * Runs against a real DOM (happy-dom) because it is a Preact hook driving
 * fetches, so the modules are imported DYNAMICALLY — Preact binds its
 * environment at evaluation time.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import type { FileClipboard, useFileClipboard as UseFileClipboardHook } from '@/client/hooks/workspace/file-clipboard';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let useFileClipboard: typeof UseFileClipboardHook;
let h: typeof PreactH;
let render: typeof PreactRender;
let act: typeof PreactAct;

const ROOT = '/ws';
const SESSION = 'new-clipboard-hook';
let mounted: FileClipboard | null = null;
let container: HTMLElement;
/** Every `/api/fs/action` request the hook posted, as its form fields. */
let requests: Array<Record<string, string>> = [];
/** What the next request answers with. */
let answer: Record<string, unknown> = { success: true, path: 'dest/a.ts' };
/** Refusals the hook reported, in order. */
let errors: string[] = [];
let completes = 0;
const nativeFetch = Bun.fetch;

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    });
  }
}

async function mountHook() {
  const { SessionStateProvider } = await import('@/client/components/common/session-state-provider/index');
  const Probe = () => {
    mounted = useFileClipboard({
      rootPath: ROOT,
      repo: '.',
      onComplete: () => { completes += 1; },
      onError: (message) => { errors.push(message); },
    });
    return null;
  };
  await act(async () => {
    render(h(SessionStateProvider, { sessionId: SESSION, children: h(Probe, {}) }), container);
  });
  await settle();
}

beforeAll(async () => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  ({ useFileClipboard } = await import('@/client/hooks/workspace/file-clipboard'));
  ({ h, render } = await import('preact'));
  ({ act } = await import('preact/test-utils'));
});

afterAll(() => {
  globalThis.fetch = nativeFetch;
  restoreDomGlobals();
});

beforeEach(() => {
  mounted = null;
  requests = [];
  errors = [];
  completes = 0;
  answer = { success: true, path: 'dest/a.ts' };
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    // The session-state store reads its blob over GET; only the transfer posts
    // carry a FormData body, so the stub answers each shape it is asked for.
    if (!init?.body) {
      return { ok: true, json: async () => ({ state: {} }), text: async () => JSON.stringify({ state: {} }) };
    }
    const form = init.body as FormData;
    const fields: Record<string, string> = {};
    for (const [key, value] of form.entries()) fields[key] = String(value);
    requests.push(fields);
    const body = JSON.stringify(answer);
    return { ok: true, json: async () => answer, text: async () => body };
  }) as unknown as typeof fetch;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

describe('useFileClipboard', () => {
  test('a move posts a cut paste for the source and target it was handed', async () => {
    await mountHook();

    await act(async () => {
      mounted?.move({ path: 'src/a.ts', name: 'a.ts', kind: 'file' }, { path: 'dest', name: 'dest', kind: 'folder' });
    });
    await settle();

    expect(requests).toEqual([
      { actionType: 'paste', sourcePath: 'src/a.ts', mode: 'cut', targetPath: 'dest', targetKind: 'folder', root: ROOT },
    ]);
    expect(completes).toBe(1);
    expect(errors).toEqual([]);
  });

  test('a move into the folder the entry already lives in posts NOTHING', async () => {
    await mountHook();

    await act(async () => {
      mounted?.move({ path: 'src/a.ts', name: 'a.ts', kind: 'file' }, { path: 'src', name: 'src', kind: 'folder' });
    });
    await settle();

    // The second of the two places this rule lives: a caller that skipped the
    // row's `dragover` gate must not reach the server either.
    expect(requests).toEqual([]);
    expect(errors).toEqual(['Already in this folder']);
    expect(completes).toBe(0);
  });

  test('a move of a folder into its own subtree posts nothing', async () => {
    await mountHook();

    await act(async () => {
      mounted?.move({ path: 'src', name: 'src', kind: 'folder' }, { path: 'src/deep', name: 'deep', kind: 'folder' });
    });
    await settle();

    expect(requests).toEqual([]);
    expect(errors[0]).toContain('itself');
  });

  test('a CUT clears the clipboard once its paste lands', async () => {
    await mountHook();

    await act(async () => {
      mounted?.cut({ path: 'src/a.ts', name: 'a.ts', kind: 'file' });
    });
    expect(mounted?.clip?.mode).toBe('cut');

    await act(async () => {
      mounted?.paste({ path: 'dest', name: 'dest', kind: 'folder' });
    });
    await settle();

    expect(requests[0]).toMatchObject({ mode: 'cut', sourcePath: 'src/a.ts' });
    expect(mounted?.clip).toBeNull();
  });

  test('a COPY stays, so the same entry pastes again', async () => {
    await mountHook();

    await act(async () => {
      mounted?.copy({ path: 'src/a.ts', name: 'a.ts', kind: 'file' });
    });
    await act(async () => {
      mounted?.paste({ path: 'dest', name: 'dest', kind: 'folder' });
    });
    await settle();
    await act(async () => {
      mounted?.paste({ path: 'other', name: 'other', kind: 'folder' });
    });
    await settle();

    expect(requests.map((request) => request.mode)).toEqual(['copy', 'copy']);
    expect(mounted?.clip?.path).toBe('src/a.ts');
  });

  test('a paste of an entry from another listing is refused with the reason', async () => {
    await mountHook();
    await act(async () => {
      mounted?.copy({ path: 'src/a.ts', name: 'a.ts', kind: 'file' });
    });
    // The scope is part of the entry: the same relative path in another
    // workspace names a different file.
    await act(async () => {
      render(null, container);
    });
    await act(async () => {
      const { SessionStateProvider } = await import('@/client/components/common/session-state-provider/index');
      const Other = () => {
        mounted = useFileClipboard({
          rootPath: '/elsewhere',
          repo: '.',
          onComplete: () => { completes += 1; },
          onError: (message) => { errors.push(message); },
        });
        return null;
      };
      render(h(SessionStateProvider, { sessionId: SESSION, children: h(Other, {}) }), container);
    });
    await settle();

    await act(async () => {
      mounted?.paste({ path: 'dest', name: 'dest', kind: 'folder' });
    });
    await settle();

    expect(requests).toEqual([]);
    expect(errors[0]).toContain('another workspace');
  });

  test('a failed transfer reports the server’s own reason and does not refresh', async () => {
    answer = { error: 'The entry on the clipboard no longer exists' };
    await mountHook();

    await act(async () => {
      mounted?.move({ path: 'src/a.ts', name: 'a.ts', kind: 'file' }, { path: 'dest', name: 'dest', kind: 'folder' });
    });
    await settle();

    expect(requests.length).toBe(1);
    expect(errors).toEqual(['The entry on the clipboard no longer exists']);
    expect(completes).toBe(0);
  });
});
