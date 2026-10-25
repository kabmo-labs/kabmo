/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The committed-history fetch vs a run this page started, and a spawn's arrival.
 *
 * While a run is live the timeline's rows are the STREAM's, and a committed
 * fetch is a lagging snapshot: for a fresh spawn there may be no transcript on
 * disk at all (omp buffers its writes until the first assistant message
 * settles), and it never carries a segment still streaming. Applying one
 * mid-run cost the operator their own turn in both directions, measured on real
 * sessions:
 *
 *   - an empty payload EMPTIED the list, so the turn they had just sent
 *     vanished until a reload;
 *   - a payload carrying the file's own copy of that turn was merged UNDER the
 *     live rows, whose ids differ (`msg-…-user` vs the echoed id), so the turn
 *     rendered twice.
 *
 * Both shapes needed the same hole: the guard was keyed on the AI placeholder,
 * which the stream RELEASES at the first assistant `message_end` while the run
 * continues. These cases pin the run as the ownership signal, and pin the two
 * directions the guard must still let through when no run is live.
 *
 * The harness is `session-load.test-util.ts`.
 */

import { describe, expect, test } from 'bun:test';
import { act } from 'preact/test-utils';
import {
  AI_PLACEHOLDER,
  ECHOED_TURN,
  OPTIMISTIC_USER,
  ids,
  makeApi,
  mount,
  resolveLoad,
  gates,
  startLiveRun,
  stubChatFetch,
  switchSession,
} from '@/client/hooks/chat/timeline/session-load.test-util';

describe('a committed fetch while a run this page started is live', () => {
  test('keeps the live timeline when the payload carries the turn under its own id', async () => {
    stubChatFetch();
    const api = makeApi();
    await mount('sess-1', api);
    await startLiveRun(api);
    // The stream has already finalized the assistant's first segment, so the
    // placeholder mark is gone while the RUN continues — the exact state the
    // guard used to read as "the live timeline is done".
    api.aiPlaceholderIdRef.current = null;

    await resolveLoad([ECHOED_TURN]);

    // Not merged: the file's copy of the turn would sit beside the bubble it
    // belongs to (different ids), rendering the same prompt twice.
    expect(ids(api)).toEqual([OPTIMISTIC_USER.id, AI_PLACEHOLDER.id]);
  });

  test('never empties the timeline when the payload has no messages yet', async () => {
    stubChatFetch();
    const api = makeApi();
    await mount('sess-1', api);
    await startLiveRun(api);
    api.aiPlaceholderIdRef.current = null;

    await resolveLoad([]);

    // The fresh spawn's transcript is not readable yet; emptying here is the
    // "my first message disappeared" report.
    expect(ids(api)).toEqual([OPTIMISTIC_USER.id, AI_PLACEHOLDER.id]);
  });

  test('leaves the run\'s generating flag alone', async () => {
    stubChatFetch();
    const api = makeApi();
    await mount('sess-1', api);
    await startLiveRun(api);
    // The mount's own session-switch reset is the only call so far.
    const before = api.generatingCalls.length;

    await resolveLoad([ECHOED_TURN]);

    expect(api.generatingCalls.length).toBe(before);
    expect(api.isGeneratingRef.current).toBe(true);
  });

  test('survives a fetch issued mid-run whose run ENDED before it landed', async () => {
    // The CI failure this pins, measured on a real run: the spawn adoption
    // re-ran the load effect and issued `/api/chat/:id` while the child was
    // streaming (ownership true), `agent_end` landed ~1 ms before the response,
    // and the payload carried `messages: []` because omp had not flushed its
    // JSONL yet. Reading the guard at RESOLVE alone saw no run, took the
    // "genuinely gone" branch, and emptied the timeline — the answer that had
    // just streamed vanished. Ownership is about the rows the payload would
    // replace, so the answer from when it was ASKED still holds.
    stubChatFetch();
    const api = makeApi();
    await mount('new-1', api);
    // The send: optimistic rows mounted, run owned by this page.
    await act(async () => {
      api.isGeneratingRef.current = true;
      api.ownRunRef.current = true;
      api.optimisticUserIdRef.current = OPTIMISTIC_USER.id;
      api.setMessages([OPTIMISTIC_USER, AI_PLACEHOLDER]);
    });
    // Spawn adoption: the URL flips to the real id, so the effect re-runs and
    // issues the history fetch NOW, while the run is still live.
    await switchSession('sess-1', api);
    expect(gates.length).toBe(2);

    // The run ends before the response arrives (the ordering in the trace).
    await act(async () => {
      api.isGeneratingRef.current = false;
      api.ownRunRef.current = false;
    });

    // The lagging snapshot: omp has not written the transcript yet.
    await resolveLoad([], 1);

    expect(ids(api)).toEqual([OPTIMISTIC_USER.id, AI_PLACEHOLDER.id]);
  });
});

describe('a spawn that adopted its id after the run ended', () => {
  /**
   * The chat opened from a WORKSPACE (`?folderId=` and no `?sessionId=`), so the
   * first send starts from a null session id and the URL flips to the child's
   * UUID when the spawn answers. `isSpawnAdopt` only recognises a `new-…` →
   * UUID move, and `isAdoptingInFlight` also required the run to still be
   * generating — so a FAST child (the scripted one answers in milliseconds)
   * finished before the URL flip, the reset branch ran, and the turn that had
   * just rendered was cleared. Measured in CI on three specs at once
   * (`rename.e2e.ts`, `editor.e2e.ts`'s drop case, `chat.e2e.ts`'s settle
   * case): the answer was on screen and then the timeline was empty.
   */
  test('keeps the optimistic rows when the adopted id arrives after the run settled', async () => {
    stubChatFetch();
    const api = makeApi();
    await mount('', api);
    // The send: optimistic rows mounted, the run owned by this page…
    await act(async () => {
      api.isGeneratingRef.current = true;
      api.ownRunRef.current = true;
      api.optimisticUserIdRef.current = OPTIMISTIC_USER.id;
      api.setMessages([OPTIMISTIC_USER, AI_PLACEHOLDER]);
    });
    // …and it ENDED before the spawn's id reached the URL.
    await act(async () => {
      api.isGeneratingRef.current = false;
      api.ownRunRef.current = false;
    });
    // The spawn answered: the send path records the id it adopted, and the URL
    // moves to it.
    api.adoptedSessionIdRef.current = 'sess-1';

    await switchSession('sess-1', api);
    // The fetch the URL flip issued answers with the transcript omp has not
    // written yet — the second half of the same bug, and the one that emptied
    // the timeline even once the reset was skipped.
    // `gates[0]`: the mount was a null session, so this flip issued the FIRST
    // read.
    await resolveLoad([], 0);

    expect(ids(api)).toEqual([OPTIMISTIC_USER.id, AI_PLACEHOLDER.id]);
  });
});

describe('a committed fetch with no local run', () => {
  test('lands the transcript, which is the reload-mid-run and open-a-session path', async () => {
    stubChatFetch();
    const api = makeApi();
    await mount('sess-1', api);

    await resolveLoad([ECHOED_TURN]);

    expect(ids(api)).toEqual([ECHOED_TURN.id]);
  });

  test('lands the transcript when the mount probe adopted a live run', async () => {
    // Opening (or reloading) a session ANOTHER writer is streaming: the probe
    // resumes the generating UI, so `isGeneratingRef` is true while this page
    // owns nothing. The transcript must still load — measured on a real
    // 333-message run, discarding it left 0 rows and only a "Load earlier
    // messages" button, whose click paged a window into an empty head.
    stubChatFetch();
    const api = makeApi();
    await mount('sess-1', api);
    await act(async () => { api.isGeneratingRef.current = true; });

    await resolveLoad([ECHOED_TURN]);

    expect(ids(api)).toEqual([ECHOED_TURN.id]);
  });

  test('empties a session whose transcript is genuinely gone', async () => {
    stubChatFetch();
    const api = makeApi();
    await mount('sess-1', api);
    await act(async () => { api.setMessages([OPTIMISTIC_USER, AI_PLACEHOLDER]); });

    await resolveLoad([]);

    expect(api.messages).toEqual([]);
  });

  test('a pending "new-…" session is never emptied, whatever the payload says', async () => {
    stubChatFetch();
    const api = makeApi();
    await mount('new-1', api);
    const before = api.generatingCalls.length;

    await resolveLoad([]);

    expect(ids(api)).toEqual([]);
    expect(api.generatingCalls.length).toBe(before);
  });
});
