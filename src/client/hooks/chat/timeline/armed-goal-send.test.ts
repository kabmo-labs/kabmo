/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A goal the operator ARMED is started by the prompt that follows.
 *
 * The two shapes turn the same send into two different things, and that is the
 * whole contract:
 *
 *  - `create` — the record is written (`startTurn: false`) and the prompt is
 *    still sent, as the goal's first turn.
 *  - `guided` — there is no objective yet, so the prompt IS the interview's
 *    opening turn; nothing is sent after it, or the same question is asked
 *    twice and two user rows appear for one answer.
 *
 * Both were measured against a real child; see the wiki page for the numbers.
 */

import { describe, expect, test } from 'bun:test';
import { act } from 'preact/test-utils';
import { makeSendHarness } from '@/client/hooks/chat/timeline/send.test-util';

// The harness installs the DOM itself. A local `restoreDomGlobals()` here would
// strip `document` for every file Bun runs after this one (measured: four
// `document is not defined` failures in `send-refusal.test.ts`), because it
// restores whatever was captured at import time rather than this file's state.

/** Stub the mode POST so a case can read what the send actually created. */
function installModePost() {
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    posts.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { posts, restore: () => { globalThis.fetch = original; } };
}

/** Only the agent route matters here: other subsystems post on mount. */
function agentPosts(posts: Array<{ url: string; body: Record<string, unknown> }>) {
  return posts.filter((entry) => entry.url.startsWith('/api/agent'));
}

describe('an ARMED goal', () => {
  test('is created at the fence of the prompt, with startTurn false, and then cleared', async () => {
    const h = makeSendHarness({ sessionId: 'omp-1' });
    const post = installModePost();
    try {
      h.goalArmRef.current = { kind: 'create', objective: 'Ship the importer', tokenBudget: 50_000, maxTurns: 4 };

      await act(async () => {
        await h.sends.executeSend('do the work', []);
      });

      // One command, to the session the prompt goes to, and the objective is
      // the one the operator armed.
      expect(agentPosts(post.posts)).toHaveLength(1);
      expect(agentPosts(post.posts)[0].url).toBe('/api/agent/omp-1');
      expect(agentPosts(post.posts)[0].body).toMatchObject({
        type: 'kabmo_mode',
        scope: 'goal',
        action: 'create',
        payload: {
          objective: 'Ship the importer',
          tokenBudget: 50_000,
          maxTurns: 4,
          // The prompt IS the goal's first turn: without this the child opens
          // its own hidden turn and the operator's message becomes a second.
          startTurn: false,
        },
      });
      // Spent, not remembered: a goal must not re-apply to the next prompt.
      expect(h.goalArmRef.current).toBeNull();
      // The prompt still went out.
      expect(h.agent.calls.prompts.map((p) => p.text)).toEqual(['do the work']);
    } finally {
      post.restore();
    }
  });

  test('a refused creation still sends the prompt and says why', async () => {
    const h = makeSendHarness({ sessionId: 'omp-1' });
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'cannot create a new goal' }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
    try {
      h.goalArmRef.current = { kind: 'create', objective: 'x' };
      await act(async () => {
        await h.sends.executeSend('do the work', []);
      });

      expect(h.agent.calls.prompts.map((p) => p.text)).toEqual(['do the work']);
      expect(h.reported.some((message) => message.includes('cannot create a new goal'))).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  test('nothing is posted when no goal is armed', async () => {
    const h = makeSendHarness({ sessionId: 'omp-1' });
    const post = installModePost();
    try {
      await act(async () => {
        await h.sends.executeSend('just a message', []);
      });
      expect(agentPosts(post.posts)).toEqual([]);
    } finally {
      post.restore();
    }
  });
});

describe('an ARMED interview', () => {
  test('turns the prompt into the kickoff, and sends nothing else', async () => {
    const h = makeSendHarness({ sessionId: 'omp-1' });
    const post = installModePost();
    try {
      h.goalArmRef.current = { kind: 'guided', rough: 'make the tests fast' };

      await act(async () => {
        await h.sends.executeSend('speed up the test suite', []);
      });

      const posts = agentPosts(post.posts);
      expect(posts).toHaveLength(1);
      // The operator's message IS the interview's opening turn: it travels to
      // the extension as the kickoff content, and no separate prompt follows.
      expect(posts[0].body).toMatchObject({
        scope: 'goal',
        action: 'guided',
        payload: { message: 'speed up the test suite' },
      });
      expect(h.agent.calls.prompts).toEqual([]);
      expect(h.goalArmRef.current).toBeNull();
    } finally {
      post.restore();
    }
  });

  test('a refused interview falls back to an ordinary prompt', async () => {
    const h = makeSendHarness({ sessionId: 'omp-1' });
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'goal-mode API missing' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
    try {
      h.goalArmRef.current = { kind: 'guided', rough: 'x' };
      await act(async () => {
        await h.sends.executeSend('speed up the test suite', []);
      });

      // The interview never started, so the words must still reach the agent as
      // an ordinary turn — losing them would swallow the operator's message.
      expect(h.agent.calls.prompts.map((p) => p.text)).toEqual(['speed up the test suite']);
      expect(h.reported.some((message) => message.includes('goal-mode API missing'))).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});
