/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The FORK send: the branch inherits the source's history, so the chat that
 * continues it must render that history — not just the new turn.
 *
 * The fork's file on disk already holds the copied rows, but the timeline skips
 * a committed read while a run this page dispatched owns the rows, and a run
 * that ends cleanly never re-reads the transcript. Measured symptom: the first
 * forked turn appeared in an empty-looking chat and the conversation it
 * continued only came back after a reload.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  act,
  installDomGlobals,
  makeSendHarness,
  originalFetch,
  requests,
  restoreDomGlobals,
} from '@/client/hooks/chat/timeline/send.test-util';
import {
  listPendingSessions,
  releasePendingSession,
  startPendingSession,
} from '@/client/hooks/chat/omp/pending-sessions';

beforeAll(() => installDomGlobals());
afterAll(() => restoreDomGlobals());
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const entry of listPendingSessions()) releasePendingSession(entry.id);
});
beforeEach(() => {
  requests.length = 0;
});

const SOURCE_MESSAGES = [
  { id: 'u1', role: 'user', content: 'first question' },
  { id: 'a1', role: 'ai', content: 'first answer' },
  { id: 'u2', role: 'user', content: 'second question' },
  { id: 'a2', role: 'ai', content: 'second answer' },
];

interface ForkStub {
  /** Resolves the source transcript read, so a case can order the race. */
  resolveSource: (body: unknown) => void;
}

/** Answers the fork POST and holds the source read open until a case asks. */
function stubForkFetch(): ForkStub {
  const source = Promise.withResolvers<Response>();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? 'GET', body: init?.body === undefined ? null : String(init.body) });
    if (url.startsWith('/api/sessions/src-1/fork')) {
      return Response.json({ sessionId: 'fork-9', sourceSessionId: 'src-1', originKind: 'fork' }, { status: 201 });
    }
    if (url.startsWith('/api/chat/src-1?limit=all')) return source.promise;
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { resolveSource: (body) => source.resolve(Response.json(body)) };
}

/** A pending fork chat bound to `src-1`, anchored at `anchor` (null = tip). */
function pendingFork(anchor: string | null): string {
  return startPendingSession(4, {
    forkSourceSessionId: 'src-1',
    ...(anchor ? { forkAnchorEntryId: anchor } : {}),
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

describe('fork send inherits the source history', () => {
  test('the branch transcript lands above the optimistic turn', async () => {
    const stub = stubForkFetch();
    const h1 = makeSendHarness({
      isOmpSession: false,
      sessionId: pendingFork('a2'),
      folders: [{ id: 4, name: 'demo', project_path: '/tmp/demo' }],
      selectedFolderId: 4,
    });
    await act(async () => {
      await h1.sends.executeSend('continue it', []);
    });
    expect(h1.adoptedSessionIdRef.current).toBe('fork-9');

    stub.resolveSource({ session: { messages: SOURCE_MESSAGES } });
    await flush();

    expect(h1.state.messages.map((m) => m.id)).toEqual([
      'u1', 'a1', 'u2', 'a2', expect.stringMatching(/^msg-\d+-user$/), expect.stringMatching(/^msg-\d+-ai$/),
    ]);
  });

  test('the anchor cuts the prefix the same way the branch cuts the file', async () => {
    const stub = stubForkFetch();
    const h1 = makeSendHarness({
      isOmpSession: false,
      sessionId: pendingFork('u2'),
      folders: [{ id: 4, name: 'demo', project_path: '/tmp/demo' }],
      selectedFolderId: 4,
    });
    await act(async () => {
      await h1.sends.executeSend('continue it', []);
    });
    stub.resolveSource({ session: { messages: SOURCE_MESSAGES } });
    await flush();
    // A user anchor branches BEFORE that turn: 'u2' is the message being replaced.
    expect(h1.state.messages.slice(0, 2).map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  test('a read that lands after the chat moved on is dropped', async () => {
    const stub = stubForkFetch();
    const h1 = makeSendHarness({
      isOmpSession: false,
      sessionId: pendingFork(null),
      folders: [{ id: 4, name: 'demo', project_path: '/tmp/demo' }],
      selectedFolderId: 4,
    });
    await act(async () => {
      await h1.sends.executeSend('continue it', []);
    });
    h1.adoptedSessionIdRef.current = 'another-chat';
    stub.resolveSource({ session: { messages: SOURCE_MESSAGES } });
    await flush();
    expect(h1.state.messages).toHaveLength(2);
    expect(h1.state.messages[0]?.id).toMatch(/^msg-\d+-user$/);
  });
});
