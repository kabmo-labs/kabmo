/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useSearchStream` folds the server's SSE frames into panel state.
 *
 * The frame that matters here is `error`. The route sends it when ripgrep exits
 * 2 — a regex it cannot compile, or a pattern it read as a flag — and the hook
 * used to drop it, so the panel rendered a failed search as "No results found."
 * The user typed `useFoo(` with Regex on, rg answered `regex parse error:
 * unclosed group`, and the workspace was reported as empty.
 *
 * The assertions are on the state the hook RETURNS, because that is what the
 * panel reads; the frames are delivered through a stubbed `fetch`, so the SSE
 * reader the route's own response goes through is the real one.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useSearchStream } from '@/client/hooks/workspace/search-stream';
import type { SearchResultItem } from '@/shared/types/fs';

type StreamState = {
  results: SearchResultItem[];
  isSearching: boolean;
  truncated: boolean;
  error: string | null;
  start: (body: Record<string, string>) => Promise<void>;
};

let mounted: StreamState | null = null;
let container: HTMLElement;
/** The SSE body the stubbed fetch answers with, verbatim. */
let sseBody: string;
const nativeFetch = Bun.fetch;

function sseResponse(body: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    });
  }
}

/** Mount the hook under the scope the panel uses, then run one search. */
async function search(scope = 'root\u0000.') {
  const Probe = ({ current }: { current: string }) => {
    mounted = useSearchStream(current);
    return null;
  };
  await act(async () => {
    render(h(Probe, { current: scope }), container);
  });
  await act(async () => {
    await mounted?.start({ q: 'useFoo(' });
  });
  await settle();
}

const installed: Record<string, unknown> = {};
const displaced: Record<string, unknown> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement'] as const) {
    displaced[key] = (globalThis as Record<string, unknown>)[key];
    installed[key] = (win as unknown as Record<string, unknown>)[key];
    (globalThis as Record<string, unknown>)[key] = installed[key];
  }
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
  sseBody = '';
  globalThis.fetch = (async () => sseResponse(sseBody)) as unknown as typeof fetch;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

describe('useSearchStream', () => {
  test('an error frame is surfaced with the message the server sent', async () => {
    sseBody = 'event: error\ndata: {"error":"rg: regex parse error:\\n    (?:useFoo()\\n    ^\\nerror: unclosed group"}\n\nevent: done\ndata: {"count":0,"truncated":false}\n\n';
    await search();

    expect(mounted?.error).toContain('regex parse error');
    expect(mounted?.results).toEqual([]);
  });

  test('a malformed error frame keeps the generic wording instead of throwing', async () => {
    sseBody = 'event: error\ndata: not-json\n\nevent: done\ndata: {"count":0}\n\n';
    await search();

    expect(mounted?.error).toBe('Search failed');
  });

  test('match frames still accumulate, and no error is invented', async () => {
    sseBody =
      'event: matches\ndata: [{"file":"a.ts","line":"1","content":"useFoo(","ranges":[]}]\n\n' +
      'event: done\ndata: {"count":1,"truncated":true}\n\n';
    await search();

    expect(mounted?.results).toHaveLength(1);
    expect(mounted?.truncated).toBe(true);
    expect(mounted?.error).toBeNull();
  });

  test('a new run clears the previous run\u2019s error', async () => {
    sseBody = 'event: error\ndata: {"error":"first run failed"}\n\nevent: done\ndata: {"count":0}\n\n';
    await search();
    expect(mounted?.error).toBe('first run failed');

    sseBody = 'event: matches\ndata: [{"file":"a.ts","line":"1","content":"x","ranges":[]}]\n\nevent: done\ndata: {"count":1}\n\n';
    await act(async () => {
      await mounted?.start({ q: 'x' });
    });
    await settle();

    expect(mounted?.error).toBeNull();
    expect(mounted?.results).toHaveLength(1);
  });
});
