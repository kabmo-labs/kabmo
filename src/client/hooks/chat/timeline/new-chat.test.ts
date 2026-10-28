/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The New Chat dialog's first send.
 *
 * The dialog's handler captured the render it was opened in, so writing the
 * pending id into the URL and invoking that captured `executeSend` dispatched
 * the FIRST prompt against the session the dialog was opened FROM: for an omp
 * session it landed in the previous chat, no spawn ever happened, and the new
 * chat showed an optimistic bubble with no stream (and no sidebar spinner, since
 * the mark was armed for the wrong id) until the operator typed a second prompt.
 *
 * The send is parked and fired by the render that actually carries the pending
 * id — pinned here, with the shared `setSearchParams` recorder standing in for
 * the URL the app would write.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { useNewChatSubmit, type NewChatSubmitDeps } from '@/client/hooks/chat/timeline/new-chat';
import type { Attachment, ChatMessageData, WorkspaceFolderData } from '@/shared/types';

let container: HTMLElement | undefined;
/** The hook result of the most recent render. */
let submit: ((text: string, attachments: Attachment[]) => void) | null = null;

function Probe({ deps }: { deps: NewChatSubmitDeps }) {
  submit = useNewChatSubmit(deps);
  return null;
}

interface Recorded {
  /** Each send with the SCOPE the deps record carried when the callback was
   *  built — the regression this hook exists for. */
  sends: Array<{ text: string; attachments: Attachment[]; scope: string | null }>;
  messages: ChatMessageData[];
  /** The URL the hook's `setSearchParams` writes into. */
  searchParams: URLSearchParams;
  deps: NewChatSubmitDeps;
}

function makeDeps(overrides: Partial<NewChatSubmitDeps> = {}): Recorded {
  const sends: Recorded['sends'] = [];
  const messages: ChatMessageData[] = [];
  const searchParams = new URLSearchParams();
  const scope: string | null = overrides.sessionId ?? 'sess-aaa';
  const deps: NewChatSubmitDeps = {
    sessionId: 'sess-aaa',
    folders: [],
    selectedFolderId: null,
    setSearchParams: (next) => {
      const base = new URLSearchParams(searchParams);
      const resolved = typeof next === 'function' ? next(base) : next;
      const params = resolved instanceof URLSearchParams ? resolved : new URLSearchParams(resolved);
      searchParams.forEach((_value, key) => searchParams.delete(key));
      params.forEach((value, key) => searchParams.set(key, value));
    },
    setLocalMessages: (next) => {
      messages.splice(0, messages.length, ...(typeof next === 'function' ? next(messages) : next));
    },
    executeSend: async (text, attachments) => {
      sends.push({ text, attachments, scope });
      return { ok: true, busy: false };
    },
    ...overrides,
  };
  return { sends, messages, searchParams, deps };
}

async function mount(deps: NewChatSubmitDeps) {
  container ??= document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(h(Probe, { deps }), container as HTMLElement);
  });
  await act(async () => {});
  return {
    /** Re-render with the deps a later scope produces — what the URL write does
     *  in the app: the tree re-renders with the new session id. */
    rerender: async (next: NewChatSubmitDeps) => {
      await act(async () => {
        render(h(Probe, { deps: next }), container as HTMLElement);
      });
      await act(async () => {});
    },
  };
}

function folderOwning(sessionId: string): WorkspaceFolderData[] {
  return [{ id: 7, name: 'jns6', project_path: '/work/jns6', sessions: [{ id: sessionId }] }] as unknown as WorkspaceFolderData[];
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterAll(() => {
  restoreDomGlobals();
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
  submit = null;
});

describe('useNewChatSubmit', () => {
  // Deterministic time: the shipped defect deferred the send through a
  // `setTimeout`, and advancing the clock is what makes that path observable
  // instead of guessing at a duration.
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test('the parked draft leaves only once the pending scope is on screen', async () => {
    const opened = makeDeps({ sessionId: 'sess-aaa' });
    const ui = await mount(opened.deps);

    await act(async () => { submit?.('halo', []); });
    const pendingId = opened.searchParams.get('sessionId') ?? '';
    expect(pendingId.startsWith('new-')).toBe(true);

    // The clock moved and the captured send path was NOT used: with the old
    // `setTimeout(() => executeSend(...))` this is where the prompt reached
    // `sess-aaa`, the chat the dialog was opened from.
    vi.advanceTimersByTime(0);
    expect(opened.sends).toEqual([]);

    // The URL write re-renders the tree with the new scope; now it goes out.
    const adopted = makeDeps({ sessionId: pendingId, folders: folderOwning(pendingId) });
    await ui.rerender(adopted.deps);
    expect(adopted.sends).toEqual([{ text: 'halo', attachments: [], scope: pendingId }]);
  });

  test('the pending session carries the workspace the chat was started from', async () => {
    // The first send SPAWNS an omp session in the folder's cwd. A dialog opened
    // from a session picked in the sidebar had no `folderId` in the URL, so the
    // spawn had no cwd and the send fell back to the simulated stream.
    const opened = makeDeps({ sessionId: 'sess-aaa', folders: folderOwning('sess-aaa') });
    await mount(opened.deps);

    await act(async () => { submit?.('halo', []); });

    expect(opened.searchParams.get('folderId')).toBe('7');
  });

  test('an explicit folder pick wins when the session is not listed under one', async () => {
    const opened = makeDeps({ sessionId: 'sess-unknown', selectedFolderId: 3 });
    await mount(opened.deps);

    await act(async () => { submit?.('halo', []); });

    expect(opened.searchParams.get('folderId')).toBe('3');
  });

  test('a folder already in the URL is never overwritten', async () => {
    const opened = makeDeps({ sessionId: 'sess-aaa', folders: folderOwning('sess-aaa') });
    opened.searchParams.set('folderId', '9');
    await mount(opened.deps);

    await act(async () => { submit?.('halo', []); });

    expect(opened.searchParams.get('folderId')).toBe('9');
  });

  test('the composer is cleared for the pending view it opens', async () => {
    const opened = makeDeps({ sessionId: 'sess-aaa' });
    await mount(opened.deps);

    await act(async () => { submit?.('halo', []); });

    // The draft now lives in the parked request, not in the composer of the
    // chat the dialog was opened from.
    expect(opened.messages).toEqual([]);
  });

  test('a draft never lands in an unrelated session that opens instead', async () => {
    const opened = makeDeps({ sessionId: 'sess-aaa' });
    const ui = await mount(opened.deps);

    await act(async () => { submit?.('halo', []); });
    // Something else navigated (a sidebar click, a back button) before the
    // pending id landed.
    const other = makeDeps({ sessionId: 'sess-bbb' });
    await ui.rerender(other.deps);
    vi.advanceTimersByTime(0);

    expect(other.sends).toEqual([]);
    expect(opened.sends).toEqual([]);
  });
});
