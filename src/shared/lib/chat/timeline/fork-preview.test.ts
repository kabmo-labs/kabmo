/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The slice a fork preview shows.
 *
 * It mirrors the server cut (`cutIndexFor` in `fork.server.ts`), because a
 * preview that ends on a different row than the branch file does is a promise
 * the first send breaks.
 */

import { describe, expect, test } from 'bun:test';
import { forkPreviewMessages } from '@/shared/lib/chat/timeline/fork-preview';
import type { ChatMessageData } from '@/shared/types';

const row = (id: string, role: ChatMessageData['role']): ChatMessageData => ({ id, role, content: id });

// u1 a1 u2 a2 u3 a3 — a turn is a user row plus everything after it.
const transcript: ChatMessageData[] = [
  row('u1', 'user'),
  row('a1', 'ai'),
  row('u2', 'user'),
  row('a2', 'ai'),
  row('u3', 'user'),
  row('a3', 'ai'),
];

describe('forkPreviewMessages', () => {
  test('no anchor is the tip: the whole transcript', () => {
    expect(forkPreviewMessages(transcript, null).map((m) => m.id)).toEqual([
      'u1', 'a1', 'u2', 'a2', 'u3', 'a3',
    ]);
  });

  test('an anchor the transcript does not carry falls back to the tip', () => {
    // A reload can outlive a message the source no longer has; the fork then
    // branches at the tip, so the preview must not claim otherwise.
    expect(forkPreviewMessages(transcript, 'gone').map((m) => m.id)).toEqual([
      'u1', 'a1', 'u2', 'a2', 'u3', 'a3',
    ]);
  });

  test('a user anchor branches BEFORE that turn', () => {
    expect(forkPreviewMessages(transcript, 'u2').map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  test('an assistant anchor keeps the turn that contains it', () => {
    expect(forkPreviewMessages(transcript, 'a2').map((m) => m.id)).toEqual([
      'u1', 'a1', 'u2', 'a2',
    ]);
  });

  test('the first user turn forks to an empty transcript', () => {
    expect(forkPreviewMessages(transcript, 'u1')).toEqual([]);
  });

  test('an anchor on the last turn keeps the whole transcript', () => {
    expect(forkPreviewMessages(transcript, 'a3')).toHaveLength(6);
  });
});
