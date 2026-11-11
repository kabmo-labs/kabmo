/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Cancelling or failing a held prompt must return its text.
 *
 * The send path clears the composer when it creates the row, so the row is the
 * only copy remaining. These cases pin where that copy goes back: the pending
 * chat's draft slot, or the existing session's — and nowhere at all when the row
 * names neither.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { restoreHeldDraft, waitingDraftSessionId } from '@/client/hooks/chat/waiting/restore';
import { forgetSession, getSessionValue } from '@/shared/lib/workspace/session-state/store';
import { CHAT_DRAFT_ATTACHMENTS_KEY, CHAT_DRAFT_KEY } from '@/shared/lib/chat/composer/draft';
import type { WaitingPrompt } from '@/shared/types/waiting';

function prompt(overrides: Partial<WaitingPrompt> = {}): WaitingPrompt {
  return {
    id: 'wait-1',
    pendingId: 'new-1',
    dependsOn: 'sess-a',
    dependsOnTitle: 'Session A',
    targetSessionId: null,
    prompt: 'summarise the diff',
    attachments: [{ id: 'a1', preview: 'data:text/plain;base64,aGk=', name: 'notes.txt', content: 'hi' }],
    model: null,
    modes: null,
    cwd: '/tmp/project',
    folderId: 1,
    status: 'cancelled',
    sessionId: null,
    error: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

afterEach(() => {
  forgetSession('new-1');
  forgetSession('sess-open');
});

describe('restoreHeldDraft', () => {
  test('writes a pending chat’s text and attachments back into its draft', () => {
    restoreHeldDraft(prompt());
    expect(getSessionValue('new-1', CHAT_DRAFT_KEY)).toBe('summarise the diff');
    expect(getSessionValue('new-1', CHAT_DRAFT_ATTACHMENTS_KEY)).toEqual([
      { id: 'a1', preview: 'data:text/plain;base64,aGk=', name: 'notes.txt', content: 'hi' },
    ]);
  });

  test('restores a next prompt into the session it targeted', () => {
    restoreHeldDraft(prompt({ pendingId: null, targetSessionId: 'sess-open' }));
    expect(waitingDraftSessionId(prompt({ pendingId: null, targetSessionId: 'sess-open' }))).toBe('sess-open');
    expect(getSessionValue('sess-open', CHAT_DRAFT_KEY)).toBe('summarise the diff');
    expect(getSessionValue('new-1', CHAT_DRAFT_KEY)).toBeUndefined();
  });

  test('a row naming no chat writes nothing', () => {
    restoreHeldDraft(prompt({ pendingId: null, targetSessionId: null }));
    expect(getSessionValue('new-1', CHAT_DRAFT_KEY)).toBeUndefined();
    expect(getSessionValue('sess-open', CHAT_DRAFT_KEY)).toBeUndefined();
  });
});
