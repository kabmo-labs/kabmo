/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which model the transcript's footer names.
 *
 * The sidebar's `runModel` belongs to the RUN row beside it: correct while a run
 * is live (it is renamed from the agent's own `get_state`), stale the moment a
 * chat switches model while idle. The session's own metadata is the answer
 * there, and it is what `/api/chat/:id` re-reads from the agent.
 */

import { describe, expect, test } from 'bun:test';
import { runIdentityFor } from '@/client/hooks/chat/timeline/run-identity';
import type { WorkspaceFolderData } from '@/shared/types';

const folder = (session: Record<string, unknown>): WorkspaceFolderData =>
  ({ sessions: [session] }) as unknown as WorkspaceFolderData;

describe('runIdentityFor', () => {
  test('an idle chat prefers the session metadata over the last run row', () => {
    const identity = runIdentityFor({
      folders: [folder({ id: 's1', streamStatus: 'finish', runModel: { provider: 'p', modelId: 'first' } })],
      sessionId: 's1',
      sessionData: { model: { provider: 'p', modelId: 'second' } },
      modelNames: { second: 'Second' },
    });
    expect(identity).toEqual({ sessionProvider: 'p', sessionModelName: 'Second' });
  });

  test('a live run keeps the sidebar identity the agent is actually serving', () => {
    const identity = runIdentityFor({
      folders: [folder({ id: 's1', streamStatus: 'stream', runModel: { provider: 'p', modelId: 'served' } })],
      sessionId: 's1',
      sessionData: { model: { provider: 'p', modelId: 'stale' } },
      modelNames: {},
    });
    expect(identity).toEqual({ sessionProvider: 'p', sessionModelName: 'served' });
  });

  test('falls back to the run row when the session metadata has no model', () => {
    const identity = runIdentityFor({
      folders: [folder({ id: 's1', streamStatus: 'finish', runModel: { provider: 'p', modelId: 'last' } })],
      sessionId: 's1',
      sessionData: null,
      modelNames: {},
    });
    expect(identity).toEqual({ sessionProvider: 'p', sessionModelName: 'last' });
  });
});
