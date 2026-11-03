/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What "close this tab" means for the agent's browser.
 *
 * The rules are shared by the route and the panel, and both halves matter:
 * a target id from ANOTHER session must be refused (the daemon is
 * project-shared), and the tab the panel watches after a close must be the
 * neighbour, not whichever page happens to be newest.
 */

import { describe, expect, test } from 'bun:test';

import { closeVerdict, neighbourTargetId, readCloseTarget } from '@/shared/lib/browser/tab-close';

describe('readCloseTarget', () => {
  test('accepts an opaque target id', () => {
    expect(readCloseTarget('3A863DE80D88040BA983CA1949531524')).toBe('3A863DE80D88040BA983CA1949531524');
    expect(readCloseTarget('  ABC123  ')).toBe('ABC123');
  });

  test('rejects anything that is not a bare id', () => {
    expect(readCloseTarget(undefined)).toBeNull();
    expect(readCloseTarget(null)).toBeNull();
    expect(readCloseTarget('')).toBeNull();
    expect(readCloseTarget(42)).toBeNull();
    expect(readCloseTarget({ targetId: 'x' })).toBeNull();
    expect(readCloseTarget('a b')).toBeNull();
    expect(readCloseTarget('../escape')).toBeNull();
    expect(readCloseTarget('a:b')).toBeNull();
    expect(readCloseTarget('x'.repeat(129))).toBeNull();
  });
});

describe('closeVerdict', () => {
  test('closes a tab this session owns and reports the survivors', () => {
    expect(closeVerdict('mine-2', ['mine-1', 'mine-2', 'mine-3'])).toEqual({
      ok: true,
      remaining: ['mine-1', 'mine-3'],
    });
  });

  test('refuses a tab another session owns, and keeps the list intact', () => {
    const verdict = closeVerdict('other-1', ['mine-1']);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('does not belong to this session');
    expect(verdict.remaining).toEqual(['mine-1']);
  });

  test('a session with no tabs refuses everything', () => {
    expect(closeVerdict('mine-1', []).ok).toBe(false);
  });
});

describe('neighbourTargetId', () => {
  test('prefers the tab to the right, in registry (creation) order', () => {
    expect(neighbourTargetId(['a', 'b', 'c'], 'b')).toBe('c');
  });

  test('falls back to the left when the closed tab was the newest', () => {
    expect(neighbourTargetId(['a', 'b', 'c'], 'c')).toBe('b');
  });

  test('nothing left to select when the last tab closes', () => {
    expect(neighbourTargetId(['only'], 'only')).toBeNull();
  });

  test('an id outside the list names no neighbour', () => {
    expect(neighbourTargetId(['a'], 'nope')).toBeNull();
  });
});
