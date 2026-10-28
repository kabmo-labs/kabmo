/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The repo pick is SHARED, not private per component or per panel.
 *
 * Every right-panel view that browses a repository keeps ONE selection
 * (`workspace.activeRepo`), because they all describe the same working tree:
 * picking in the file explorer must move the Source Control view and a
 * terminal's cwd with it. A session that picked before the views shared a slot
 * still has the value under its own panel's key, and must keep it.
 *
 * Rendered with `h()` (no JSX) against happy-dom. The persist path is driven
 * through `flushSession` rather than the 600 ms debounce, so no timer is waited
 * on.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import type { ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { resolveRepoForPanel, useRepoScope } from '@/client/hooks/workspace/repo-scope';
import { flushSession } from '@/shared/lib/workspace/session-state/store';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
/** The runner's own globals, restored on teardown — deleting them would strip natives (Event/CustomEvent) every later file needs. */const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
/** The runner's own fetch — this file replaces it for the whole process. */
/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

const ROOT = '/ws';
const OTHER_ROOT = '/other';
const SESSION = 'new-repo-scope';

let container: HTMLElement | undefined;
let stored: Record<string, unknown> = {};
const posted: Record<string, unknown>[] = [];

/**
 * Reads the shared slot at `rootPath`, and — when `repo` is given — owns a
 * button that writes it, the way a panel's picker does.
 */
function Consumer({ id, rootPath, repo }: { id: string; rootPath: string; repo?: string }) {
  const { activeRepo, setActiveRepo } = useRepoScope(rootPath);
  return h(
    'div',
    { id },
    h('span', null, activeRepo),
    repo === undefined ? null : h('button', { onClick: () => setActiveRepo(repo) }, 'pick'),
  );
}

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  target.fetch = async (_input: unknown, init?: { method?: string; body?: unknown }) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (init?.method === 'POST') {
      const body: unknown = JSON.parse(String(init.body));
      // Test stub: the persist route takes `{ state: object }`.
      if (body && typeof body === 'object' && 'state' in body && body.state && typeof body.state === 'object' && !Array.isArray(body.state)) {
        posted.push(body.state as Record<string, unknown>);
      }
      return json({ success: true });
    }
    return json({ sessionId: SESSION, state: stored });
  };
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
  // The runner's own fetch comes back: `delete` removed the global outright,
  // so every suite after this one had no `fetch` at all.
  target.fetch = nativeFetch;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
  stored = {};
  posted.length = 0;
});

/** Mounts one session's consumers and drains the session-state load. */
async function mount(children: ComponentChild, sessionId = SESSION): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(SessionStateProvider, { sessionId, children }), container as HTMLElement);
  });
  for (let i = 0; i < 20; i += 1) await act(async () => {});
  if (!container) throw new Error('expected the mounted container');
  return container;
}

const read = (id: string) => container?.querySelector(`#${id} span`)?.textContent;

/** Clicks the picker button inside `#owner`'s consumer. */
async function clickPicker() {
  await act(async () => {
    (container?.querySelector('#owner button') as HTMLButtonElement).click();
  });
}

describe('useRepoScope', () => {
  test('a write by one view reaches another view of the same workspace', async () => {
    await mount(
      h('div', null, h(Consumer, { id: 'owner', rootPath: ROOT, repo: 'projects/shared' }), h(Consumer, { id: 'follower', rootPath: ROOT })),
    );
    expect(read('follower')).toBe('.');

    await clickPicker();

    expect(read('owner')).toBe('projects/shared');
    expect(read('follower')).toBe('projects/shared');
  });

  test('a pick made under another root does not name a directory of this one', async () => {
    await mount(
      h('div', null, h(Consumer, { id: 'owner', rootPath: ROOT, repo: 'projects/shared' }), h(Consumer, { id: 'elsewhere', rootPath: OTHER_ROOT })),
    );

    await clickPicker();

    expect(read('owner')).toBe('projects/shared');
    expect(read('elsewhere')).toBe('.');
  });

  test('adopts a pre-shared per-panel pick once, and leaves one key behind', async () => {
    stored = {
      'git.activeRepo': { root: ROOT, repo: 'projects/from-git' },
      'files.activeRepo': { root: ROOT, repo: 'projects/from-files' },
      'search.activeRepo': { root: OTHER_ROOT, repo: 'projects/elsewhere' },
    };
    const sessionId = 'new-repo-scope-legacy';

    await mount(h(Consumer, { id: 'reader', rootPath: ROOT }), sessionId);
    // The git panel's value wins: it is the pick the root-level fallback and the
    // Source Control indicator were built around.
    expect(read('reader')).toBe('projects/from-git');

    await act(async () => {
      await flushSession(sessionId);
    });

    const persisted = posted.at(-1);
    expect(persisted?.['workspace.activeRepo']).toEqual({ root: ROOT, repo: 'projects/from-git' });
    expect(persisted?.['git.activeRepo']).toBeUndefined();
    expect(persisted?.['files.activeRepo']).toBeUndefined();
    expect(persisted?.['search.activeRepo']).toBeUndefined();
  });

  test('adopts only a legacy pick that belongs to this root', async () => {
    // The highest-priority legacy key names another workspace: the value that
    // does belong here is the one to keep, and adopting the other would consume
    // the one chance to migrate this session.
    stored = {
      'git.activeRepo': { root: OTHER_ROOT, repo: 'projects/elsewhere' },
      'files.activeRepo': { root: ROOT, repo: 'projects/from-files' },
    };
    await mount(h(Consumer, { id: 'reader', rootPath: ROOT }), 'new-repo-scope-mixed');
    expect(read('reader')).toBe('projects/from-files');

    // Only values for another root: nothing to adopt, the root stays selected.
    if (container) render(null, container);
    stored = { 'git.activeRepo': { root: OTHER_ROOT, repo: 'projects/elsewhere' } };
    await mount(h(Consumer, { id: 'reader', rootPath: ROOT }), 'new-repo-scope-stale');
    expect(read('reader')).toBe('.');
  });
});

describe('resolveRepoForPanel', () => {
  test('keeps the pick when the workspace root is not a repo', () => {
    // The user chose a nested repo; nothing about the root being a folder of
    // repositories changes that.
    expect(resolveRepoForPanel('projects/a', ['.', 'projects/a', 'projects/b'])).toBe('projects/a');
    expect(resolveRepoForPanel('projects/a', ['projects/a', 'projects/b'])).toBe('projects/a');
  });

  test('keeps the root when the root IS a repo', () => {
    // `.` is a real repository here, so it is a legitimate answer rather than
    // "no pick" — falling through to a nested one would move the panel off the
    // repo the user is looking at.
    expect(resolveRepoForPanel('.', ['.', 'projects/a'])).toBe('.');
  });

  test('falls back to the FIRST repo, which is the sorted one', () => {
    // No pick, and the root is not a repo: the fallback is the list's first
    // entry. The list arrives sorted from the server (`getRepos`), which is what
    // makes this deterministic — measured, `readdir` order differs between
    // machines and after a directory is rewritten, so an unsorted list made the
    // default repository differ between two reads of the same workspace.
    expect(resolveRepoForPanel('.', ['alpha', 'conflicted'])).toBe('alpha');
    expect(resolveRepoForPanel('.', ['conflicted', 'alpha'])).toBe('conflicted');
  });

  test('answers the root when there is nothing to fall back to', () => {
    expect(resolveRepoForPanel('.', [])).toBe('.');
  });
});
