/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The archive summary's contract.
 *
 * A batch archive has no dialog, so this sentence is the ONLY report the user
 * gets: it must name both what was archived and what was refused (a bare count
 * cannot be reconciled against the list), and it must choose the right tone so
 * a partial failure is not dressed as success.
 */

import { describe, expect, test } from 'bun:test';
import { archiveOutcomeMessage, type BatchArchiveOutcome } from '@/client/hooks/workspace/batch-archive';

function outcome(partial: Partial<BatchArchiveOutcome>): BatchArchiveOutcome {
  return { archived: [], refused: [], ...partial };
}

describe('archiveOutcomeMessage', () => {
  test('nothing changed reports nothing', () => {
    expect(archiveOutcomeMessage(outcome({}))).toBeNull();
  });

  test('a clean run is a success and counts the sessions', () => {
    expect(archiveOutcomeMessage(outcome({ archived: ['a', 'b', 'c'] })))
      .toEqual({ message: 'Archived 3 sessions.', tone: 'success' });
  });

  test('one archived session is singular', () => {
    expect(archiveOutcomeMessage(outcome({ archived: ['a'] })))
      .toEqual({ message: 'Archived 1 session.', tone: 'success' });
  });

  test('a partial refusal names both counts and is not dressed as success', () => {
    const report = archiveOutcomeMessage(outcome({
      archived: ['a', 'b'],
      refused: [{ id: 'new-1', error: 'This chat has not been created yet.' }],
    }));
    expect(report?.message).toContain('Archived 2 sessions');
    expect(report?.message).toContain('1 refused');
    expect(report?.tone).toBe('error');
  });

  test('an all-refused run is an error and names the refusal count', () => {
    const report = archiveOutcomeMessage(outcome({
      refused: [{ id: 'new-1', error: 'This chat has not been created yet.' }],
    }));
    expect(report?.message).toBe('1 session could not be archived.');
    expect(report?.tone).toBe('error');
  });

  test('a request-level failure reports the server reason', () => {
    expect(archiveOutcomeMessage(outcome({ error: 'Could not archive (HTTP 500).' })))
      .toEqual({ message: 'Could not archive (HTTP 500).', tone: 'error' });
  });
});
