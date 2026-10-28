/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A git-status read belongs to the tree it was asked for.
 *
 * The status now rides the `git:<root>\0<repo>` topic, so what this file pins
 * is the scope rule on the topic path: a panel that switches repos must never
 * render the previous tree's changes, and a snapshot that lands after the scope
 * moved must be ignored — the activity bar's dot would otherwise describe the
 * repository the user just left.
 *
 * Driven through a real server and socket: the frames are the hub's, and a
 * stubbed socket would only prove the stub's timing.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useGitStatus } from '@/client/hooks/workspace/git-status';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { gitTopic } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';

const ROOT = '/ws';

let container: HTMLElement | undefined;
/** The server a case runs against; every scope answers from the same resolvers. */
let server: RealtimeTestServer;

/** Renders the change count for one scope. */
function Harness({ repo }: { repo: string }) {
  const { changes } = useGitStatus(ROOT, repo, true);
  return h('span', { id: 'count' }, String(changes.length));
}

/** A payload the hook will render as `n` changes. */
function statusOf(count: number): unknown {
  return {
    changes: Array.from({ length: count }, (_, i) => ({ path: `f${i}.ts`, status: ' M' })),
    branch: 'main',
    branches: ['main'],
    remoteBranches: [],
  };
}

/** What each scope's snapshot should answer, by scope string. */
const answers = new Map<string, unknown>();

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
  resetRealtimeClient();
  server?.stop();
});

afterAll(() => {
  restoreDomGlobals();
});

/** Start a server whose git topics answer from `answers`. */
async function startServer(): Promise<void> {
  const resolver: TopicResolver = async (topic) => answers.get(topic) ?? statusOf(0);
  server = await startRealtimeTestServer(new Map<string, TopicResolver>([
    [gitTopic(`${ROOT}\u0000.`), resolver],
    [gitTopic(`${ROOT}\u0000projects/a`), resolver],
    [gitTopic(`${ROOT}\u0000projects/b`), resolver],
  ]));
  installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
}

/** Show the hook at `repo`, waiting for its topic snapshot to land. */
async function show(repo: string): Promise<void> {
  if (!container) {
    container = document.createElement('div');
    document.body.appendChild(container);
  }
  await act(async () => {
    render(h(Harness, { repo }), container as HTMLElement);
  });
  await server.waitForTopic(gitTopic(`${ROOT}\u0000${repo}`), (value) => value !== null);

  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

const count = () => Number(container?.querySelector('#count')?.textContent);

describe('useGitStatus scope', () => {
  test('never renders one scope\'s changes under another', async () => {
    answers.set(gitTopic(`${ROOT}\u0000projects/a`), statusOf(2));
    answers.set(gitTopic(`${ROOT}\u0000.`), statusOf(1));
    await startServer();

    await show('projects/a');
    expect(count()).toBe(2);

    // The picker moves to the workspace root: the old repo's two changes are
    // not the root's, and the hook must render the ROOT's answer, not hold the
    // previous tree's list while the new snapshot is in flight.
    await show('.');
    expect(count()).toBe(1);
  });

  test('a fresh snapshot replaces the previous list', async () => {
    answers.set(gitTopic(`${ROOT}\u0000projects/a`), statusOf(2));
    await startServer();

    await show('projects/a');
    expect(count()).toBe(2);

    await act(async () => {
      server.publish(gitTopic(`${ROOT}\u0000projects/a`), statusOf(3));
      await server.waitForTopic(gitTopic(`${ROOT}\u0000projects/a`), (value) => (value as { changes?: unknown[] })?.changes?.length === 3);
    });
    await act(async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(count()).toBe(3);
  });

  test('a switch back to an earlier repo shows THAT repo, not the visit before it', async () => {
    answers.set(gitTopic(`${ROOT}\u0000projects/a`), statusOf(2));
    answers.set(gitTopic(`${ROOT}\u0000.`), statusOf(1));
    await startServer();

    await show('projects/a');
    expect(count()).toBe(2);
    await show('.');
    expect(count()).toBe(1);

    // Back to `projects/a`: the scope string matches the earlier visit, and the
    // hook must render what the topic answers now, not the stale two.
    answers.set(gitTopic(`${ROOT}\u0000projects/a`), statusOf(1));
    await show('projects/a');
    expect(count()).toBe(1);
  });
});
