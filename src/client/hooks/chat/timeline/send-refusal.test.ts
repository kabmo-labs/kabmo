/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How the send path REPORTS a refusal.
 *
 * The optimistic bubbles are rolled back either way, so without a report the
 * operator's turn simply VANISHES — which is the reported "gagal kirim prompt":
 * the send did not go out and nothing said why. The server's own reason (a
 * child that could not start, a session another process owns) is what makes
 * the difference between "it failed" and "here is what to do".
 *
 * Split from `send-execute.test.ts` (which owns composing and executing a
 * send) so both files stay under the repo's 350-line ceiling; the harness is
 * shared through `send.test-util.ts`.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act, installDomGlobals, makeSendHarness, originalFetch, requests, restoreDomGlobals, stubComposerFetch } from '@/client/hooks/chat/timeline/send.test-util';

beforeAll(() => {
  installDomGlobals();
});
afterAll(() => {
  restoreDomGlobals();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('a refused send', () => {
  beforeEach(() => {
    requests.length = 0;
    stubComposerFetch();
  });

  test("reports the server's own reason", async () => {
    const h1 = makeSendHarness({
      agent: { sendPromptOk: false, sendPromptError: 'omp exited (code 1): Could not restore model a/b' },
    });
    await act(async () => {
      await h1.sends.executeSend('hello', []);
    });
    expect(h1.reported).toEqual(['Prompt not sent: omp exited (code 1): Could not restore model a/b']);
  });

  test('still reports a refusal that carries no reason', async () => {
    const h1 = makeSendHarness({ agent: { sendPromptOk: false } });
    await act(async () => {
      await h1.sends.executeSend('hello', []);
    });
    expect(h1.reported).toEqual(['Prompt not sent: the session refused it']);
  });

  test('is rolled back as well as reported', async () => {
    const h1 = makeSendHarness({ agent: { sendPromptOk: false } });
    await act(async () => {
      await h1.sends.executeSend('hello', []);
    });
    expect(h1.state.messages).toEqual([]);
  });

  test('a DELIVERED send reports nothing', async () => {
    const h1 = makeSendHarness();
    await act(async () => {
      await h1.sends.executeSend('hello', []);
    });
    expect(h1.reported).toEqual([]);
  });
});