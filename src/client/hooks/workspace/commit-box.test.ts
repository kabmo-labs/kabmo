/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `useCommitBox` — the amend pre-fill's three rules, mounted directly.
 *
 * The pre-fill is a WRITE into a text the user is about to commit, so the ways
 * it could go wrong are the whole subject: it overwrites a draft the user
 * typed, its async answer lands after the user un-ticked (or typed), or
 * un-ticking wipes text the user edited. Each is pinned here against a real
 * fetch stub that answers `?headMessage=1`, so the read the panel issues is
 * part of what is asserted.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import type { CommitBoxState, useCommitBox as UseCommitBoxHook } from '@/client/hooks/workspace/commit-box';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { forgetSession } from '@/shared/lib/workspace/session-state/store';

// The hook, Preact and `act` are imported DYNAMICALLY in `beforeAll`, after
// `installDomGlobals` has put a window on the global: a static import would
// evaluate Preact against the runner's windowless global and the render would
// fail before the first case. Same reason `file-clipboard.test.ts` does.
let useCommitBox: typeof UseCommitBoxHook;
let h: typeof PreactH;
let render: typeof PreactRender;
let act: typeof PreactAct;

const ROOT = '/ws';
const SESSION = 'new-commit-box';
const PREVIOUS = 'feat(git): the previous subject\n\nwith a body';
let mounted: CommitBoxState | null = null;
/** Every `/api/fs/git` url the hook asked for. */
let reads: string[] = [];
/** The actions the hook handed to `execute`. */
let actions: Array<{ type: string; extra?: Record<string, string> }> = [];
/** What the pre-fill read answers with; `null` is an unborn HEAD. */
let headMessage: string | null = PREVIOUS;
/** Holds the read open, so a case can act while it is in flight. */
let gate: Promise<void> | null = null;
let release: () => void = () => {};
let container: HTMLElement;
const nativeFetch = Bun.fetch;

async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    });
  }
}

async function mount(stored: Record<string, unknown> = {}) {
  const { SessionStateProvider } = await import('@/client/components/common/session-state-provider/index');
  const Probe = () => {
    mounted = useCommitBox({
      rootPath: ROOT,
      repo: '.',
      execute: (type, _file, extra) => { actions.push({ type, extra }); },
    });
    return null;
  };
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/state')) {
      return new Response(JSON.stringify({ state: stored }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    reads.push(url);
    if (gate) await gate;
    return new Response(JSON.stringify({ success: true, message: headMessage }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(SessionStateProvider, { sessionId: SESSION, children: h(Probe, {}) }), container);
  });
  await settle();
}

beforeAll(async () => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  ({ useCommitBox } = await import('@/client/hooks/workspace/commit-box'));
  ({ h, render } = await import('preact'));
  ({ act } = await import('preact/test-utils'));
});

afterAll(() => {
  globalThis.fetch = nativeFetch;
  restoreDomGlobals();
});

afterEach(() => {
  mounted = null;
  reads = [];
  actions = [];
  headMessage = PREVIOUS;
  gate = null;
  release = () => {};
  if (container) render(null, container);
  container?.remove();
  // The store is a module singleton: without this the previous case's draft is
  // the next case's `git.commitDraft`, which is exactly the state the rules
  // under test read.
  forgetSession(SESSION);
});

describe('useCommitBox amend pre-fill', () => {
  test('ticking Amend seeds the draft from HEAD, on demand', async () => {
    await mount();
    // Nothing is read until the checkbox moves — the status payload travels on
    // the realtime topic and must not carry a `git log` per tool call.
    expect(reads).toHaveLength(0);

    await act(async () => { mounted!.toggleAmend(true); });
    await settle();

    expect(reads.some((u) => u.includes('headMessage=1'))).toBe(true);
    expect(mounted!.message).toBe(PREVIOUS);
    // The whole message, not just the subject: an amend REPLACES it.
    expect(mounted!.message).toContain('with a body');
    expect(mounted!.seeded).toBe(true);
  });

  test('a draft the user already typed is never overwritten', async () => {
    await mount();
    await act(async () => { mounted!.setMessage('my own message'); });
    await act(async () => { mounted!.toggleAmend(true); });
    await settle();

    expect(mounted!.message).toBe('my own message');
    expect(mounted!.seeded).toBe(false);
  });

  test('typing while the read is in flight keeps the typed draft', async () => {
    await mount();
    gate = new Promise<void>((resolve) => { release = resolve; });

    await act(async () => { mounted!.toggleAmend(true); });
    await act(async () => { mounted!.setMessage('typed during the fetch'); });
    await act(async () => { release(); });
    await settle();

    expect(mounted!.message).toBe('typed during the fetch');
    expect(mounted!.seeded).toBe(false);
  });

  test('un-ticking while the read is in flight discards its answer', async () => {
    await mount();
    gate = new Promise<void>((resolve) => { release = resolve; });

    await act(async () => { mounted!.toggleAmend(true); });
    await act(async () => { mounted!.toggleAmend(false); });
    await act(async () => { release(); });
    await settle();

    expect(mounted!.message).toBe('');
  });

  test('un-ticking clears the seeded text but keeps an edited draft', async () => {
    await mount();
    await act(async () => { mounted!.toggleAmend(true); });
    await settle();
    expect(mounted!.message).toBe(PREVIOUS);

    // Untouched: the seeded text is this hook's write, so it goes.
    await act(async () => { mounted!.toggleAmend(false); });
    expect(mounted!.message).toBe('');

    // Edited: "ganti total" is the user's text from here on, and un-ticking
    // must not throw their work away.
    await act(async () => { mounted!.toggleAmend(true); });
    await settle();
    await act(async () => { mounted!.setMessage('replaced entirely'); });
    await act(async () => { mounted!.toggleAmend(false); });
    expect(mounted!.message).toBe('replaced entirely');
  });

  test('an unborn HEAD seeds nothing', async () => {
    headMessage = null;
    await mount();
    await act(async () => { mounted!.toggleAmend(true); });
    await settle();
    expect(mounted!.message).toBe('');
    expect(mounted!.seeded).toBe(false);
  });

  test('commit sends the draft and the amend flag, then clears both', async () => {
    await mount();
    await act(async () => { mounted!.toggleAmend(true); });
    await settle();
    await act(async () => { mounted!.commit(); });
    await settle();

    expect(actions).toEqual([{ type: 'commit', extra: { message: PREVIOUS, amend: '1' } }]);
    expect(mounted!.message).toBe('');
    expect(mounted!.amend).toBe(false);
  });
});
