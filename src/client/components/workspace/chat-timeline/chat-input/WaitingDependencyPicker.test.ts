/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two client rules that decide whether a prompt is HELD or SENT.
 *
 * Both are about a state the composer cannot see: a dropdown that lists only
 * running sessions can still go stale while the draft is being written, and the
 * pick itself has to survive a remount or the prompt the user deferred is sent
 * immediately — the one outcome the feature exists to prevent.
 */

import { describe, expect, test } from 'bun:test';
import { waitingCandidates } from '@/client/components/workspace/chat-timeline/chat-input/WaitingDependencyPicker';
import type { WorkspaceFolderData } from '@/shared/types/workspace';

function folder(id: number, name: string, sessions: { id: string; title: string }[]): WorkspaceFolderData {
  return {
    id,
    name,
    isExpanded: true,
    hasMore: false,
    totalSessions: sessions.length,
    sessions: sessions.map((session) => ({ ...session, folder_id: id })),
  };
}

const folders = [
  folder(1, 'alpha', [{ id: 'sess-a', title: 'Refactor parser' }, { id: 'sess-idle', title: 'Idle chat' }]),
  folder(2, 'beta', [{ id: 'sess-b', title: 'Build pipeline' }]),
];

describe('waitingCandidates', () => {
  test('offers only sessions with a run in flight', () => {
    const candidates = waitingCandidates(folders, { 'sess-a': 'stream', 'sess-b': 'stream', 'sess-idle': 'finish' }, null);
    expect(candidates.map((candidate) => candidate.id)).toEqual(['sess-a', 'sess-b']);
  });

  // A finished run's badge is a terminal one-shot; a session whose row says
  // `finish` has nothing to wait for, and offering it would create a prompt the
  // next sweep releases.
  test('a finished or aborted session is not offered', () => {
    expect(waitingCandidates(folders, { 'sess-a': 'finish', 'sess-b': 'abort' }, null)).toEqual([]);
  });

  test('never offers the session the composer writes to', () => {
    const candidates = waitingCandidates(folders, { 'sess-a': 'stream', 'sess-b': 'stream' }, 'sess-a');
    expect(candidates.map((candidate) => candidate.id)).toEqual(['sess-b']);
  });

  test('carries the folder name so two similarly titled sessions are told apart', () => {
    const candidates = waitingCandidates(folders, { 'sess-b': 'stream' }, null);
    expect(candidates[0]).toEqual({ id: 'sess-b', title: 'Build pipeline', folderName: 'beta' });
  });

  // The case the feature exists for, and the one the first version missed: a
  // freshly spawned session has a `stream` row immediately, while omp's
  // transcript — which the sidebar structure is scanned from — lands seconds
  // later. Driving the list off the folders offered nothing at all.
  test('offers a streaming id the structure has not scanned yet', () => {
    const candidates = waitingCandidates(
      [folder(1, 'alpha', [])],
      { 'brand-new-id': 'stream' },
      null,
      (id) => (id === 'brand-new-id' ? 'Just started' : undefined),
    );
    expect(candidates).toEqual([{ id: 'brand-new-id', title: 'Just started', folderName: '' }]);
  });

  test('a streaming id with no hint is named by its id rather than dropped', () => {
    expect(waitingCandidates([], { 'raw-id': 'stream' }, null)[0]).toEqual({
      id: 'raw-id',
      title: 'raw-id',
      folderName: '',
    });
  });

  test('a scanned streaming session is not listed twice', () => {
    const candidates = waitingCandidates(folders, { 'sess-a': 'stream' }, null);
    expect(candidates.map((candidate) => candidate.id)).toEqual(['sess-a']);
  });
});
