/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A folder that is not a repository gets ONE control instead of the panel's
 * chrome.
 *
 * The status read reports `isRepo: false` for it (it used to fold git's refusal
 * into an empty change list on branch `main`), and the panel drew its branch
 * toolbar, commit box and "No changes found." over a directory where every one of
 * them fails with `fatal: not a git repository` — the reported "the git panel has
 * no function here, only the dropdown works".
 *
 * Split from `index.test.ts`: the two files together exceeded the repo's line
 * ceiling, and each mounts its own harness.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { GitPanel } from '@/client/components/workspace/git-panel';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { gitTopic, reposTopic } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';

const ROOT = '/ws';
const SESSION = 'new-git-panel-init';
const TOPIC = gitTopic(`${ROOT}\u0000.`);

/** The runner's own fetch, reached through `Bun` so a leaked stub cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

let container: HTMLElement;
let server: RealtimeTestServer;
/** Every action the panel posted, as its form fields — reset per mount. */
let actionRequests: Array<Record<string, unknown>> = [];

/**
 * A folder outside every repository, as `readGitStatus` reports it: an EMPTY
 * change list carrying git's own refusal. The `isRepo` flag is what the panel
 * reads — the empty list and `main` are the same fields a clean repository has.
 */
const NOT_A_REPO = {
  changes: [],
  branch: 'main',
  branches: [],
  remoteBranches: [],
  isRepo: false,
  error: 'fatal: not a git repository (or any of the parent directories): .git',
};

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  resetRealtimeClient();
  server?.stop();
});

afterAll(() => {
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
  restoreDomGlobals();
});

/** Mount the panel over a server that answers the not-a-repository payload. */
async function mount(): Promise<void> {
  actionRequests = [];
  server = await startRealtimeTestServer(new Map<string, TopicResolver>([
    [TOPIC, async () => NOT_A_REPO],
    [reposTopic(ROOT), async () => ({ repos: ['.'], reposPending: false })],
  ]));
  const win = new Window({ url: `http://127.0.0.1:${server.port}` });
  installDomGlobals(win);
  const target = globalThis as unknown as Record<string, unknown>;
  target.WebSocket = pristineWebSocket;
  target.fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/state')) return json({ sessionId: SESSION, state: {} });
    if (url.includes('reposOnly')) return json({ repos: ['.'], reposPending: false });
    if (init?.method === 'POST') {
      // Duck-typed, not `instanceof FormData`: the body is built by the panel in
      // the happy-dom realm, so an identity check would miss it.
      const body = init.body as { forEach?: (fn: (value: unknown, key: string) => void) => void } | null;
      const fields: Record<string, unknown> = {};
      body?.forEach?.((value, key) => { fields[key] = value; });
      actionRequests.push(fields);
      return json({ success: true });
    }
    // The panel's own HTTP read answers the same state: both paths agree.
    return json(NOT_A_REPO);
  };

  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: SESSION,
        children: h(GitPanel, { rootPath: ROOT, enabled: true }),
      }),
      container,
    );
  });
  await server.waitForTopic(TOPIC, (value) => value !== null);
  for (let i = 0; i < 20; i += 1) await act(async () => {});
}

describe('GitPanel without a repository', () => {
  test('offers Initialize instead of the toolbar, commit box and change list', async () => {
    await mount();

    expect(container.textContent).toContain('Not a Git repository');
    expect(container.querySelector('button[aria-label="Initialize Git repository"]')).toBeTruthy();
    // The chrome that cannot act on this folder is GONE, not merely empty.
    expect(container.textContent).not.toContain('No changes found.');
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('button[aria-label="Sync with upstream"]')).toBeNull();
  });

  test('the button posts the init action for the scoped folder', async () => {
    await mount();

    const button = container.querySelector('button[aria-label="Initialize Git repository"]') as HTMLButtonElement | null;
    if (!button) throw new Error('no initialize control rendered');
    await act(async () => { button.click(); });
    for (let i = 0; i < 20; i += 1) await act(async () => {});

    expect(actionRequests).toHaveLength(1);
    expect(actionRequests[0]?.actionType).toBe('init');
    expect(actionRequests[0]?.repo).toBe('.');
    expect(actionRequests[0]?.root).toBe(ROOT);
  });
});
