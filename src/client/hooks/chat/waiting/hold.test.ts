/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The hold path: what makes a prompt deferred instead of sent.
 *
 * Three behaviours are pinned, and each is a decision rather than an
 * implementation detail:
 *
 *   - a stale pick (the session finished while the draft was written) SENDS,
 *     and says so — a wait created on it would be released by the next sweep;
 *   - a refusal KEEPS the draft, because the user's text is the one thing that
 *     cannot be recovered from anywhere else;
 *   - a success writes the pending row's cue, which is what keeps the sidebar
 *     row on screen until the dispatch adopts it.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { holdPromptForDependency, type HoldDeps } from '@/client/hooks/chat/waiting/hold';
import {
  listPendingSessions,
  releasePendingSession,
  startPendingSession,
} from '@/client/hooks/chat/omp/pending-sessions';
import { pendingSessionWait } from '@/client/hooks/chat/omp/pending-waiting';
import type { WaitingCandidate } from '@/client/components/workspace/chat-timeline/chat-input/WaitingDependencyPicker';
import type { Attachment } from '@/shared/types/chat';

const DEPENDENCY: WaitingCandidate = { id: 'sess-a', title: 'Refactor parser', folderName: 'alpha' };

interface Recorded {
  drafts: string[];
  attachments: Attachment[][];
  errors: string[];
  cleared: number;
  posted: Record<string, unknown>[];
}

const nativeFetch = globalThis.fetch;
/** The id `startPendingSession` minted for this case; the store owns the clock. */
let pendingId = '';

function harness(overrides: Partial<HoldDeps> = {}): { deps: HoldDeps; recorded: Recorded } {
  const recorded: Recorded = { drafts: [], attachments: [], errors: [], cleared: 0, posted: [] };
  const deps: HoldDeps = {
    sessionId: pendingId,
    folders: [{ id: 1, name: 'alpha', project_path: '/tmp/alpha', isExpanded: true, hasMore: false, totalSessions: 0, sessions: [] }],
    selectedFolderId: 1,
    composerModelRef: { current: { provider: 'anthropic', modelId: 'claude', thinkingLevel: 'high' } },
    accessModeRef: { current: 'always-ask' },
    spawnModesRef: { current: { plan: false, goal: false } },
    streamStatusMap: { 'sess-a': 'stream' },
    setInputValue: (value) => recorded.drafts.push(value),
    setAttachments: (value) => recorded.attachments.push(value),
    reportActionError: (message) => recorded.errors.push(message),
    clearChoice: () => { recorded.cleared += 1; },
    ...overrides,
  };
  return { deps, recorded };
}

beforeEach(() => {
  pendingId = startPendingSession(1);
  (globalThis as Record<string, unknown>).fetch = async (_input: unknown, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    createdBody = body;
    return new Response(JSON.stringify({ prompt: { id: 'wait-1', ...body, status: 'waiting' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
});

let createdBody: Record<string, unknown> = {};

afterEach(() => {
  globalThis.fetch = nativeFetch;
  for (const entry of listPendingSessions()) releasePendingSession(entry.id);
  createdBody = {};
});

describe('holdPromptForDependency', () => {
  test('writes the row and marks the pending chat as waiting', async () => {
    const { deps, recorded } = harness();
    const held = await holdPromptForDependency(deps, DEPENDENCY, 'summarise it', []);

    expect(held).toBe(true);
    expect(recorded.drafts).toEqual(['']);
    expect(recorded.attachments).toEqual([[]]);
    expect(recorded.cleared).toBe(1);
    expect(createdBody).toMatchObject({
      dependsOn: 'sess-a',
      dependsOnTitle: 'Refactor parser',
      prompt: 'summarise it',
      cwd: '/tmp/alpha',
      folderId: 1,
      model: { provider: 'anthropic', modelId: 'claude', thinkingLevel: 'high', accessMode: 'always-ask' },
    });
    expect(pendingSessionWait(pendingId)).toMatchObject({ waitId: 'wait-1', dependsOn: 'sess-a' });
  });

  test('no pick means the caller sends normally', async () => {
    const { deps, recorded } = harness();
    expect(await holdPromptForDependency(deps, null, 'hello', [])).toBe(false);
    expect(recorded.drafts).toEqual([]);
  });

  // The dropdown was opened while the dependency was running; by the time the
  // user hit send it had finished. Holding would be a wait of zero length.
  test('a dependency that finished meanwhile sends instead, and says so', async () => {
    const { deps, recorded } = harness({ streamStatusMap: { 'sess-a': 'finish' } });
    expect(await holdPromptForDependency(deps, DEPENDENCY, 'hello', [])).toBe(false);
    expect(recorded.errors).toEqual(['"Refactor parser" has already finished — sending now instead of waiting.']);
    expect(recorded.cleared).toBe(1);
    expect(recorded.drafts).toEqual([]);
  });

  test('a refused request keeps the draft and reports the server reason', async () => {
    (globalThis as Record<string, unknown>).fetch = async () =>
      new Response(JSON.stringify({ error: 'That session has already finished' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    const { deps, recorded } = harness();
    expect(await holdPromptForDependency(deps, DEPENDENCY, 'hello', [])).toBe(false);
    expect(recorded.errors).toEqual(['That session has already finished']);
    expect(recorded.drafts).toEqual([]);
    expect(pendingSessionWait(pendingId)).toBeNull();
  });

  test('a chat with no workspace is refused before anything is written', async () => {
    const { deps, recorded } = harness({ folders: [], selectedFolderId: null });
    expect(await holdPromptForDependency(deps, DEPENDENCY, 'hello', [])).toBe(false);
    expect(recorded.errors).toEqual(['Pick a workspace before holding this prompt.']);
    expect(createdBody).toEqual({});
  });
});
