/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A cancelled fork must not leak into the next chat.
 *
 * Reported: fork a chat, back out of it, press New Session — the new chat's
 * view still carried the source transcript above its composer. Cause: the URL
 * kept `?forkFrom=`/`?forkAt=` and `usePendingBranch` reads them as the CURRENT
 * pending chat's branch whenever the store entry lacks one, which a brand-new
 * entry always does. These assert the navigation rule that prevents it.
 */

import { describe, expect, test } from 'bun:test';
import { clearBranchParams, newSessionParams } from '@/client/lib/router/branch-params';

function forkedUrl(): URLSearchParams {
  return new URLSearchParams('sessionId=new-100&folderId=3&forkFrom=abc&forkAt=entry-9');
}

describe('newSessionParams', () => {
  test('a new chat after a cancelled fork carries no branch hints', () => {
    const next = newSessionParams(forkedUrl(), 'new-200', 3);
    expect(next.get('sessionId')).toBe('new-200');
    expect(next.get('forkFrom')).toBeNull();
    expect(next.get('forkAt')).toBeNull();
    expect(next.get('parentSessionId')).toBeNull();
  });

  test('the folder the new chat runs in survives', () => {
    expect(newSessionParams(forkedUrl(), 'new-200', 7).get('folderId')).toBe('7');
  });

  test('a chat with no folder drops the stale one instead of keeping it', () => {
    expect(newSessionParams(forkedUrl(), 'new-200', null).get('folderId')).toBeNull();
  });

  test('a stale parent hint from a child session is cleared too', () => {
    const next = newSessionParams(
      new URLSearchParams('sessionId=new-1&parentSessionId=parent-1'),
      'new-2',
      1,
    );
    expect(next.get('parentSessionId')).toBeNull();
  });
});

describe('clearBranchParams', () => {
  test('keeps the chat the URL names and its unrelated params', () => {
    const next = clearBranchParams(new URLSearchParams('sessionId=real-1&subagent=sub-2'));
    expect(next.get('sessionId')).toBe('real-1');
    expect(next.get('subagent')).toBe('sub-2');
  });

  test('does not mutate the caller’s params', () => {
    const prev = forkedUrl();
    clearBranchParams(prev);
    expect(prev.get('forkFrom')).toBe('abc');
  });
});
