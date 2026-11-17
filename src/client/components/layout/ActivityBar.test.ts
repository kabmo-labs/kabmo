/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Source Control dot belongs to that panel, so it must describe the repo the
 * panel is on. It polled the workspace root instead: with `projects/a` selected
 * the dot answered for the root's repository, and it kept answering for the repo
 * the user had just left until the next poll.
 *
 * The dot now reads the `git:<root>\0<repo>` topic, so this drives it through a
 * real realtime server: the topic a scope is subscribed to IS the assertion —
 * a dot that answers for the wrong tree subscribes to the wrong topic.
 *
 * Rendered with `h()` (no JSX) against happy-dom.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ActivityBar } from '@/client/components/layout/ActivityBar';
import { ACTIVITY_BAR_WIDTH_PX } from '@/client/lib/ui/control-plate';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { useRepoScope } from '@/client/hooks/workspace/repo-scope';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { gitTopic } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

const ROOT = '/ws';
const SESSION = 'new-activity-dot';

let container: HTMLElement;
let server: RealtimeTestServer;
/** Every scope the dot subscribed to, so the topic it asked for is assertable. */
const subscribedScopes: string[] = [];

/** The picker the panel owns: writes the slot the dot follows. */
function Picker({ repo }: { repo: string }) {
  const { setActiveRepo } = useRepoScope(ROOT);
  return h('button', { id: 'pick', onClick: () => setActiveRepo(repo) }, 'pick');
}

// Installed per CASE, not per file: another suite's teardown can strip
// `window` mid-file when the runner interleaves files, and this hook's
// first render would then throw `window is not defined`.
beforeEach(async () => {
  // Only `projects/a` has anything to report, so the dot is a verdict on which
  // scope it asked about.
  const status = (changes: unknown[]) => ({ changes, branch: 'main', branches: ['main'], remoteBranches: [] });
  const resolver: TopicResolver = async (topic) => {
    subscribedScopes.push(topic);
    return topic === gitTopic(`${ROOT}\u0000projects/a`) ? status([{ path: 'a.ts', status: ' M' }]) : status([]);
  };
  server = await startRealtimeTestServer(new Map<string, TopicResolver>([
    [gitTopic(`${ROOT}\u0000.`), resolver],
    [gitTopic(`${ROOT}\u0000projects/a`), resolver],
  ]));
  const win = new Window({ url: `http://127.0.0.1:${server.port}` });
  installDomGlobals(win);
  const target = globalThis as unknown as Record<string, unknown>;
  target.WebSocket = pristineWebSocket;
  target.fetch = async (input: unknown) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/state')) {
      return json({ sessionId: SESSION, state: { 'workspace.activeRepo': { root: ROOT, repo: 'projects/a' } } });
    }
    if (url.includes('reposOnly')) return json({ repos: ['.', 'projects/a', 'projects/b'] });
    return json({ changes: [] });
  };
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  target.fetch = nativeFetch;
  restoreDomGlobals();
});

afterEach(() => {
  // UNMOUNT, not just detach. A detached container keeps its Preact tree alive,
  // and any effect that subscribes to a module-level store will re-render it —
  // which throws once `afterAll` has restored the runner's globals and there is
  // no `window`. The panel under test reads a plugin store now, so a detached
  // tree is a live tree that fails in a later file.
  if (container) {
    render(null, container);
    container.remove();
  }
  subscribedScopes.length = 0;
  // The settings snapshot is module state shared by every suite in one `bun
  // test` process, and a case here writes a panel order into it.
  primeKabmoSettings({});
  resetRealtimeClient();
  server?.stop();
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: SESSION,
        children: h('div', null, h(Picker, { repo: '.' }), h(ActivityBar, {
          side: 'right',
          activePanel: 'git',
          onChangePanel: () => {},
          isPanelOpen: true,
          hasActiveContext: true,
          activeProjectPath: ROOT,
        })),
      }),
      container,
    );
  });
  await server.waitForTopic(gitTopic(`${ROOT}\u0000projects/a`), (value) => value !== null);
  for (let i = 0; i < 20; i += 1) await act(async () => {});
  return container;
}

const dot = () => Boolean(container.querySelector('[title="Ada perubahan git"]'));

describe('ActivityBar git dot', () => {
  test('reports the selected repo, and follows the picker to the root', async () => {
    await mount();

    // The stored pick is projects/a, so the dot asked about THAT topic — not
    // the workspace root's.
    expect(subscribedScopes).toContain(gitTopic(`${ROOT}\u0000projects/a`));
    expect(dot()).toBe(true);

    await act(async () => {
      (container.querySelector('#pick') as HTMLButtonElement).click();
    });
    await server.waitForTopic(gitTopic(`${ROOT}\u0000.`), (value) => value !== null);
    await act(async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });

    // The picker moved to the root: the dot follows to that topic and clears.
    expect(subscribedScopes).toContain(gitTopic(`${ROOT}\u0000.`));
    expect(dot()).toBe(false);
  });
});

describe('ActivityBar width', () => {
  test('the rail is the width the navbar aligns its last control to', async () => {
    // The navbar derives its right inset from this constant, so the rail must
    // actually be that wide — a class that drifted from it would put the
    // toggle's centre off the rail's axis with nothing failing.
    await mount();
    const nav = container.querySelector('nav') as HTMLElement;
    expect(nav.style.width).toBe(`${ACTIVITY_BAR_WIDTH_PX}px`);
  });
});



