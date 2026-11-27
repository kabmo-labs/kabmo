/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ONE resolution of "which workspace does a new chat run in".
 *
 * The prewarm fires for it, the pending chat's `?folderId=` carries it, and the
 * first send spawns in it. When those disagreed the prompt landed in another
 * workspace than the warmed child: measured as the previous right-panel scope
 * surviving a New Chat opened from a session in a different folder.
 */

import { describe, expect, test } from 'bun:test';

import { newChatFolderId } from '@/shared/lib/workspace/active-project';
import type { WorkspaceFolderData } from '@/shared/types';

const FOLDERS = [
  { id: 7, name: 'alpha', project_path: '/work/alpha', sessions: [{ id: 'omp-a' }] },
  { id: 9, name: 'beta', project_path: '/work/beta', sessions: [{ id: 'omp-b' }] },
  { id: 11, name: 'unbound', project_path: null, sessions: [] },
] as unknown as WorkspaceFolderData[];

describe('newChatFolderId', () => {
  test('the folder owning the source session wins over the right-panel scope', () => {
    expect(newChatFolderId(FOLDERS, 'omp-a', 9)).toBe(7);
  });

  test('the composer pick is the fallback when the session is under no folder', () => {
    expect(newChatFolderId(FOLDERS, 'omp-unknown', 9)).toBe(9);
    expect(newChatFolderId(FOLDERS, null, 11)).toBe(11);
  });

  test('a pick the sidebar has not listed yet is kept verbatim', () => {
    // The id is the user's choice; the send resolves it against the list later.
    expect(newChatFolderId(FOLDERS, null, 42)).toBe(42);
  });

  test('nothing to resolve is null, never a guessed workspace', () => {
    expect(newChatFolderId(FOLDERS, 'omp-unknown', null)).toBeNull();
    expect(newChatFolderId([], null, undefined)).toBeNull();
  });
});
