/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { formatNewSessionTitle, isPendingSessionId, pendingSessionCreatedAt, pendingSessionTitle, sessionIdEpochMs } from '@/shared/lib/omp/session/default-title';

describe('pendingSessionCreatedAt', () => {
  test('parses the epoch out of a pending session id', () => {
    expect(pendingSessionCreatedAt('new-1737000000000')).toBe(1737000000000);
  });

  test('is NaN for a real omp UUID', () => {
    expect(Number.isNaN(pendingSessionCreatedAt('01a08410-8135-772c-b1cc-9ceed604deec'))).toBe(true);
  });

  test('treats a bare prefix as epoch 0 because Number("") is 0', () => {
    expect(pendingSessionCreatedAt('new-')).toBe(0);
  });

  test('is NaN for a non-numeric suffix', () => {
    expect(Number.isNaN(pendingSessionCreatedAt('new-abc'))).toBe(true);
  });

  test('is NaN for null and undefined', () => {
    expect(Number.isNaN(pendingSessionCreatedAt(null))).toBe(true);
    expect(Number.isNaN(pendingSessionCreatedAt(undefined))).toBe(true);
  });
});

describe('sessionIdEpochMs', () => {
  test('decodes the creation clock from a v7 session id', () => {
    // The id and the clock below are a real pair: this session's own JSONL was
    // created at 2026-10-03T00:50:11.431Z.
    expect(sessionIdEpochMs('01a0ff3d-6f67-726d-b0ff-8e6a0d7d0e4a')).toBe(1790988611431);
  });

  test('is NaN for a v4 UUID, which carries no clock', () => {
    expect(Number.isNaN(sessionIdEpochMs('110ec58a-a0f2-4ac4-8393-c866d813b8d1'))).toBe(true);
  });

  test('is NaN for pending, empty and malformed ids', () => {
    expect(Number.isNaN(sessionIdEpochMs('new-1737000000000'))).toBe(true);
    expect(Number.isNaN(sessionIdEpochMs(''))).toBe(true);
    expect(Number.isNaN(sessionIdEpochMs(null))).toBe(true);
    expect(Number.isNaN(sessionIdEpochMs('01a0ff3d6f6772'))).toBe(true);
  });
});

describe('pendingSessionTitle', () => {
  test('reflects the id epoch rather than the current clock', () => {
    const title = pendingSessionTitle('new-1737000000000');
    expect(title).toContain('New Session - ');
    expect(title).toBe(formatNewSessionTitle(new Date(1737000000000)));
  });

  test('names an adopted v7 session id by ITS clock, so the row does not churn', () => {
    // The sidebar renders this title while omp's transcript scan cannot see the
    // session yet. Stamping it with `new Date()` advanced the seconds on every
    // revalidate; the id's own clock holds still across calls.
    const id = '01a0ff3d-6f67-726d-b0ff-8e6a0d7d0e4a';
    const first = pendingSessionTitle(id);
    expect(first).toBe(formatNewSessionTitle(new Date(sessionIdEpochMs(id))));
    expect(pendingSessionTitle(id)).toBe(first);
  });

  test('falls back to now for a non-numeric id without throwing', () => {
    expect(pendingSessionTitle('new-not-a-number').startsWith('New Session')).toBe(true);
  });
});

describe('isPendingSessionId', () => {
  test('is true for a pending id and false for a settled one', () => {
    expect(isPendingSessionId('new-1737000000000')).toBe(true);
    expect(isPendingSessionId('ses_alpha')).toBe(false);
  });
});
