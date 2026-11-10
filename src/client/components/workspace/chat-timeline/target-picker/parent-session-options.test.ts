/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which sessions the child composer may name as a parent: every REAL session,
 * in sidebar order, never a pending or archived one.
 */

import { describe, expect, test } from 'bun:test';
import { parentSessionOptions } from '@/client/components/workspace/chat-timeline/target-picker/ParentSessionPicker';
import type { WorkspaceFolderData } from '@/shared/types';

const folders = [
  {
    id: 1,
    name: 'one',
    sessions: [
      { id: 'a', folder_id: 1, title: 'Alpha' },
      { id: 'new-123', folder_id: 1, title: 'Pending' },
      { id: 'archived', folder_id: 1, title: 'Old', is_archived: 1 },
    ],
  },
  {
    id: 2,
    name: 'two',
    sessions: [{ id: 'b', folder_id: 2, title: 'Beta', harness: 'claude' }],
  },
] as unknown as WorkspaceFolderData[];

describe('parentSessionOptions', () => {
  test('lists real sessions in sidebar order with their folder', () => {
    expect(parentSessionOptions(folders)).toEqual([
      { id: 'a', title: 'Alpha', folderId: 1, folderName: 'one' },
      { id: 'b', title: 'Beta', folderId: 2, folderName: 'two', harness: 'claude' },
    ]);
  });

  test('never offers a pending chat or an archived session', () => {
    const ids = parentSessionOptions(folders).map((option) => option.id);
    expect(ids).not.toContain('new-123');
    expect(ids).not.toContain('archived');
  });

  test('excludes the chat being composed', () => {
    expect(parentSessionOptions(folders, 'a').map((option) => option.id)).toEqual(['b']);
  });
});
