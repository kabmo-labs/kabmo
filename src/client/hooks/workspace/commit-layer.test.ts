/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The commit modal's two data hooks: the paging cursor behind "load more" and the
 * per-file diff fetch behind expanding a changed file. Both are asserted against
 * a stubbed fetch, never a live server: `skip` must advance by the rows git
 * RETURNED, not the rows kept — a hash-less row that normalization drops still
 * occupied a position in git's ordering, so counting only the kept rows
 * re-requests it and the page overlaps; `total` arrives with the FIRST page and a
 * later response that omits it must not erase it. `useCommitInteractions` fetches
 * a file's diff once and remembers it, and maps each menu action onto the one
 * callback the modal owns. The tree fold lives in `git-tree.test.ts`; rendered
 * with `h()` (no JSX) against happy-dom, no timer waited on.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useCommitPagination } from '@/client/hooks/workspace/commit-pagination';
import { useCommitInteractions } from '@/client/hooks/workspace/commit-interactions';
import { COMMIT_PAGE_SIZE } from '@/shared/lib/fs/commit-page';
import type { CommitHistoryPage, GitCommit, GitCommitFile } from '@/shared/types/git';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown so later files still have them. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
/** The runner's own fetch, put back on teardown — deleting it strips the global every later file needs. *//** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

/** The paging handle the hook exposes (the module exports no named type). */
interface PageHandle {
  commits: GitCommit[];
  hasMore: boolean;
  totalCount?: number;
  isLoadingMore: boolean;
  handleLoadMore: () => Promise<void>;
}

/** The interactions handle the hook exposes. */
interface InteractionsHandle {
  fileDiffs: Record<string, string>;
  expandedFiles: Set<string>;
  loadingFiles: Set<string>;
  handleToggleFile: (commitHash: string, file: GitCommitFile) => Promise<void>;
  handleCommitAction: (action: string, commit: GitCommit) => void;
}

const ROOT = '/ws';
const REPO = 'projects/app';

let container: HTMLElement;

interface Pending {
  url: string;
  fields: Record<string, string>;
  /** Answer with JSON, or a raw string body that is not JSON. */
  respond: (body: unknown, status?: number) => void;
}

const pending: Pending[] = [];
const hashRow = (hash: string) => ({ hash, shortHash: hash.slice(0, 7), message: `m-${hash}` });

/** Answers the `confirm`/`prompt` dialogs the menu actions open. */
let confirmAnswer = true;
let promptAnswer: string | null = 'typed-name';

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  Object.assign(win, { confirm: () => confirmAnswer, prompt: () => promptAnswer });
  target.fetch = ((input: unknown, init?: RequestInit) => {
    const fields: Record<string, string> = {};
    if (init?.body instanceof FormData) for (const [key, value] of init.body.entries()) fields[key] = String(value);
    const { promise, resolve } = Promise.withResolvers<Response>();
    pending.push({
      url: String(input),
      fields,
      respond: (body, status = 200) =>
        resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
    });
    return promise;
  }) as unknown as typeof fetch;
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
  if (nativeFetch) target.fetch = nativeFetch;
  else delete target.fetch;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  pending.length = 0;
  // Knobs a case moves, so no assertion depends on test order.
  activeRepo = REPO;
  executeAction = recordAction;
  confirmAnswer = true;
  promptAnswer = 'typed-name';
});

/** Mounts a probe and drains the effects it queued. */
async function mount(node: unknown) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(node as never, container as HTMLElement);
  });
  for (let i = 0; i < 6; i += 1) await act(async () => {});
}

/** Drains the fetch promise chain and the render it queues. */
async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    });
  }
}

/** Answers a pending request and drains the chain it feeds. */
async function answer(index: number, body: unknown) {
  await act(async () => {
    pending[index].respond(body);
  });
  await settle();
}

// ---------------------------------------------------------------------------

let output: CommitHistoryPage | null = null;
let isGraphMode = false;
let page: PageHandle | null = null;

function PageProbe() {
  page = useCommitPagination({ output, isGraphMode, rootPath: ROOT, activeRepo: REPO });
  return h('div', { id: 'page' }, `${page.commits.length}|${page.hasMore}|${page.totalCount ?? 'none'}`);
}

async function showPage() {
  if (!container) {
    await mount(h(PageProbe, {}));
    return;
  }
  await act(async () => {
    render(h(PageProbe, {}), container as HTMLElement);
  });
  await settle();
}

const pageText = () => container?.querySelector('#page')?.textContent;
/** Click "load more" and let the request it starts reach the stub. */
async function loadMore() {
  await act(async () => {
    void page?.handleLoadMore();
  });
  await settle();
}

describe('useCommitPagination', () => {
  test('shows the first page with its real total, and falls back to the page size for hasMore', async () => {
    const rows = Array.from({ length: COMMIT_PAGE_SIZE }, (_, i) => hashRow(`a${i}`));
    output = { title: 'History', data: rows, total: 646 };
    await showPage();
    expect(pageText()).toBe(`${COMMIT_PAGE_SIZE}|true|646`);

    // A short page is the end of the history.
    output = { title: 'History', data: rows.slice(0, 3) };
    await showPage();
    expect(pageText()).toBe('3|false|646');
  });

  test('advances skip by the rows git returned, dedupes by hash, and ignores a second click in flight', async () => {
    output = { title: 'History', data: Array.from({ length: COMMIT_PAGE_SIZE }, (_, i) => hashRow(`a${i}`)), hasMore: true, total: 646 };
    await showPage();

    await loadMore();
    await loadMore(); // The in-flight guard: still one request.
    expect(pending).toHaveLength(1);
    expect(pending[0].url).toBe('/api/fs/git');
    // The first page already handed over 50 rows, so the cursor starts there.
    expect(pending[0].fields).toEqual({ actionType: 'history', limit: '50', skip: '50', root: ROOT, repo: REPO });

    // 50 raw rows: one duplicate of page 1, one hash-less row that normalization
    // drops, and 48 new ones. 49 reach the list, but all 50 advance the cursor.
    const second = [hashRow('a0'), { shortHash: 'orphan', message: 'no hash' }, ...Array.from({ length: 48 }, (_, i) => hashRow(`b${i}`))];
    await answer(0, { success: true, data: second, hasMore: true, total: 646 });
    expect(pageText()).toBe(`${COMMIT_PAGE_SIZE + 48}|true|646`);

    await loadMore();
    expect(pending).toHaveLength(2);
    expect(pending[1].fields.skip).toBe('100');
  });

  test('a graph page asks for the graph action, and a refused page ends the scroll', async () => {
    isGraphMode = true;
    output = { title: 'Graph', data: Array.from({ length: COMMIT_PAGE_SIZE }, (_, i) => hashRow(`a${i}`)), hasMore: true };
    await showPage();

    await loadMore();
    expect(pending[0].fields.actionType).toBe('graph');
    await answer(0, { success: false });
    expect(pageText()).toBe(`${COMMIT_PAGE_SIZE}|false|none`);

    // hasMore is off, so a further click issues nothing.
    await loadMore();
    expect(pending).toHaveLength(1);
    isGraphMode = false;
  });

  test('a load-more response without a total keeps the count the first page established', async () => {
    output = { title: 'History', data: Array.from({ length: COMMIT_PAGE_SIZE }, (_, i) => hashRow(`a${i}`)), hasMore: true, total: 646 };
    await showPage();
    await loadMore();
    await answer(0, { success: true, data: [hashRow('z0')], hasMore: false });
    expect(pageText()).toBe(`${COMMIT_PAGE_SIZE + 1}|false|646`);
  });
});

// ---------------------------------------------------------------------------

const actions: Array<{ type: string; file?: string; extra?: Record<string, string> }> = [];
let interactions: InteractionsHandle | null = null;
/** The callback the probe is handed; a test clears it to model a panel with none. */
const recordAction = (type: string, file?: string, extra?: Record<string, string>): void => (void actions.push({ type, file, extra }));
let activeRepo = REPO;
let executeAction: typeof recordAction | undefined = recordAction;

function InteractionsProbe() {
  interactions = useCommitInteractions({ onExecuteAction: executeAction, rootPath: ROOT, activeRepo });
  const { expandedFiles, fileDiffs, loadingFiles } = interactions;
  return h('div', { id: 'state' }, `${expandedFiles.size}|${loadingFiles.size}|${JSON.stringify(fileDiffs)}`);
}

async function showInteractions() {
  if (!container) {
    await mount(h(InteractionsProbe, {}));
    return;
  }
  await act(async () => {
    render(h(InteractionsProbe, {}), container as HTMLElement);
  });
  await settle();
}

const file: GitCommitFile = { file: 'src/app.ts', status: 'M', additions: 3, deletions: 1 };
const commit: GitCommit = { hash: 'deadbeef', shortHash: 'deadbee', author: 'a', date: '', message: 'm', parents: [] };
/** Expand or collapse the file and let a diff request reach the stub. */
async function toggle() {
  await act(async () => {
    void interactions?.handleToggleFile(commit.hash, file);
  });
  await settle();
}
const state = () => container?.querySelector('#state')?.textContent ?? '';

describe('useCommitInteractions', () => {
  test('fetches a file diff once, remembers it, and does not refetch after collapse', async () => {
    await showInteractions();
    await toggle();

    expect(pending).toHaveLength(1);
    expect(pending[0].fields).toEqual({ actionType: 'commit_diff', hash: commit.hash, file: file.file, root: ROOT, repo: REPO });
    expect(state()).toBe('1|1|{}');

    await answer(0, { diff: 'DIFF-BODY' });
    expect(state()).toBe(`1|0|{"${commit.hash}:${file.file}":"DIFF-BODY"}`);

    await toggle(); // Collapse.
    expect(state()).toBe(`0|0|{"${commit.hash}:${file.file}":"DIFF-BODY"}`);

    await toggle(); // Re-expand: the remembered diff is reused.
    expect(pending).toHaveLength(1);
    expect(state()).toBe(`1|0|{"${commit.hash}:${file.file}":"DIFF-BODY"}`);
  });

  test('a file already carrying its diff is never fetched', async () => {
    await showInteractions();
    await act(async () => {
      void interactions?.handleToggleFile(commit.hash, { ...file, diff: 'INLINE' });
    });
    await settle();
    expect(pending).toHaveLength(0);
    expect(state()).toBe('1|0|{}');
  });

  test('a refusal and an unreadable response both surface in the tab', async () => {
    await showInteractions();
    await toggle();
    await answer(0, { error: 'not a repository' });
    expect(state()).toContain('// Error: not a repository');

    await act(async () => {
      void interactions?.handleToggleFile('cafebabe', { ...file, file: 'other.ts' });
    });
    await settle();
    await act(async () => pending[1].respond('', 502));
    await settle();
    expect(state()).toContain('// Error loading diff:');
  });

  test('the repo is only sent when the pick is a subdirectory', async () => {
    activeRepo = '.';
    await showInteractions();
    await toggle();
    expect(pending[0].fields.repo).toBeUndefined();
  });

  test('each menu action maps to the one callback, with its own payload', async () => {
    await showInteractions();
    actions.length = 0;

    await act(async () => interactions?.handleCommitAction('checkout', commit));
    expect(actions).toEqual([{ type: 'checkout', file: undefined, extra: { branch: commit.hash } }]);

    await act(async () => interactions?.handleCommitAction('cherry_pick', commit));
    expect(actions.at(-1)).toEqual({ type: 'cherry_pick', file: undefined, extra: { hash: commit.hash } });

    promptAnswer = 'hard';
    await act(async () => interactions?.handleCommitAction('reset', commit));
    expect(actions.at(-1)).toEqual({ type: 'reset_commit', file: undefined, extra: { hash: commit.hash, mode: 'hard' } });

    // A refused confirm, and an out-of-range reset mode, are both no-ops.
    confirmAnswer = false;
    await act(async () => interactions?.handleCommitAction('revert', commit));
    promptAnswer = 'sideways';
    await act(async () => interactions?.handleCommitAction('reset', commit));
    expect(actions).toHaveLength(3);

    // A panel that installs no callback is a no-op, not a throw.
    executeAction = undefined;
    await showInteractions();
    await act(async () => interactions?.handleCommitAction('checkout', commit));
    expect(actions).toHaveLength(3);
  });
});
