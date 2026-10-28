/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Repo discovery now rides the `repos:<root>` realtime topic, so what this file
 * pins is the store's own rules against a REAL socket: a new root never reports
 * the previous root's list, one subscription per root is shared, a snapshot is
 * adopted, a server republish (the background walk finishing) reaches the
 * listener, and a rescan goes out over HTTP.
 *
 * Driven through a real server and socket rather than a stubbed fetch: the
 * whole point of the change is that the walk's completion arrives as a frame,
 * and a fake would only prove the fake's timing.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { createRepoStore, UNKNOWN_LIST } from '@/client/hooks/workspace/repo-scope/store';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { reposTopic } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';

let server: RealtimeTestServer | undefined;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterAll(() => {
  restoreDomGlobals();
});

afterEach(() => {
  server?.stop();
  server = undefined;
  resetRealtimeClient();
});

/** A resolver table keyed by root, so each root answers its own list. */
function resolversFor(byRoot: Map<string, { repos: string[]; reposPending?: boolean }>): Map<string, TopicResolver> {
  const map = new Map<string, TopicResolver>();
  for (const [root, payload] of byRoot) {
    map.set(reposTopic(root), async () => payload);
  }
  return map;
}

/** A store whose rescan requests are recorded instead of sent. */
function makeStore() {
  const requests: string[] = [];
  const store = createRepoStore({
    fetch: async (url) => {
      requests.push(url);
      return { repos: ['.', 'projects/rescanned'], reposPending: false };
    },
  });
  return { store, requests };
}

/** Let the socket's frames settle into the store. */
async function drain(): Promise<void> {
  for (let i = 0; i < 16; i += 1) await Promise.resolve();
}

describe('repo store over the repos topic', () => {
  test('a snapshot is adopted, and a republish reaches the listener', async () => {
    server = await startRealtimeTestServer(resolversFor(new Map([['/ws/a', { repos: ['.', 'projects/a'] }]])));
    installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
    const { store } = makeStore();

    const seen: string[][] = [];
    const unsubscribe = store.subscribe('/ws/a', () => seen.push(store.snapshot('/ws/a').repos));
    await server.waitForTopic(reposTopic('/ws/a'), (value) => value !== null);
    await drain();

    expect(store.snapshot('/ws/a').repos).toEqual(['.', 'projects/a']);

    // The background walk finished: the server republishes the root's topic.
    server.publish(reposTopic('/ws/a'), { repos: ['.', 'projects/a', 'projects/late'], reposPending: false });
    await server.waitForTopic(reposTopic('/ws/a'), (value) => (value as { repos?: unknown[] })?.repos?.length === 3);
    await drain();

    expect(store.snapshot('/ws/a').repos).toEqual(['.', 'projects/a', 'projects/late']);
    expect(seen).toContainEqual(['.', 'projects/a', 'projects/late']);
    unsubscribe();
  });

  test('a new root never reports the previous root\'s repos', async () => {
    server = await startRealtimeTestServer(resolversFor(new Map([
      ['/ws/a', { repos: ['.', 'projects/a'] }],
      ['/ws/b', { repos: ['.', 'projects/b'] }],
    ])));
    installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
    const { store } = makeStore();

    const unsubscribeA = store.subscribe('/ws/a', () => {});
    await server.waitForTopic(reposTopic('/ws/a'), (value) => value !== null);
    await drain();
    expect(store.snapshot('/ws/a').repos).toEqual(['.', 'projects/a']);

    // Root B has no entry, so it starts from the root alone — not from A's list.
    expect(store.snapshot('/ws/b')).toEqual(UNKNOWN_LIST);
    unsubscribeA();

    const unsubscribeB = store.subscribe('/ws/b', () => {});
    await server.waitForTopic(reposTopic('/ws/b'), (value) => value !== null);
    await drain();
    expect(store.snapshot('/ws/b').repos).toEqual(['.', 'projects/b']);
    // A's list was never published under B.
    expect(store.snapshot('/ws/a').repos).toEqual(['.', 'projects/a']);
    unsubscribeB();
  });

  test('a rescan asks the server over HTTP', async () => {
    server = await startRealtimeTestServer(resolversFor(new Map([['/ws/a', { repos: ['.'] }]])));
    installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
    const { store, requests } = makeStore();

    const unsubscribe = store.subscribe('/ws/a', () => {});
    await server.waitForTopic(reposTopic('/ws/a'), (value) => value !== null);
    await drain();

    store.rescan('/ws/a');
    await store.settled('/ws/a');

    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('reposOnly=1');
    expect(requests[0]).toContain('rescan=1');
    expect(store.snapshot('/ws/a').repos).toEqual(['.', 'projects/rescanned']);
    unsubscribe();
  });

  test('one topic subscription serves every listener of the same root', async () => {
    let resolves = 0;
    const resolvers = new Map<string, TopicResolver>([
      [reposTopic('/ws/a'), async () => { resolves += 1; return { repos: ['.', 'projects/a'] }; }],
    ]);
    server = await startRealtimeTestServer(resolvers);
    installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
    const { store } = makeStore();

    const first = store.subscribe('/ws/a', () => {});
    const second = store.subscribe('/ws/a', () => {});
    await server.waitForTopic(reposTopic('/ws/a'), (value) => value !== null);
    await drain();

    // The topic resolved ONCE for two listeners: the store shares one
    // subscription per root rather than one per panel.
    expect(resolves).toBe(1);
    first();
    second();
  });
});
