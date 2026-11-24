/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { journalUnavailableMessage } from '@/shared/lib/fs/journal-unavailable';

describe('journalUnavailableMessage', () => {
  test('a snapshot race names the race, not a size cap', () => {
    const message = journalUnavailableMessage({ reason: 'snapshot-race' });
    expect(message).toContain('snapshot');
    expect(message).not.toContain('MB');
  });

  test('a stored copy that cannot be read back says so', () => {
    expect(journalUnavailableMessage({ reason: 'unreadable' })).toContain('could not be read back');
  });

  test('an over-cap side prints the store’s own limit', () => {
    expect(journalUnavailableMessage({ reason: 'too-large', limitBytes: 32 * 1024 * 1024 })).toBe(
      'The journal did not store this file’s content (over 32.0 MB), so the two sides are unknown.',
    );
    expect(journalUnavailableMessage({ reason: 'too-large', limitBytes: 8 * 1024 * 1024 })).toContain('8.0 MB');
  });

  test('an unknown reason does not invent a cap', () => {
    expect(journalUnavailableMessage({})).not.toContain('MB');
  });
});
