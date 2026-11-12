/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The prompt-recall store: one row per prompt the operator sent, scoped to a
 * session or merged across all of them, newest first, duplicates collapsed.
 *
 * Runs against a throwaway SQLite file (never the developer's own database).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getDb } from '@/server/db.server';
import { listPrompts, recordPrompt } from '@/server/lib/chat/prompt-history.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

describe('recordPrompt', () => {
  test('stores a prompt under its session', async () => {
    await recordPrompt('s1', 'first prompt');
    expect(await listPrompts('s1')).toEqual(['first prompt']);
  });

  test('trims the text and ignores an empty prompt', async () => {
    await recordPrompt('s1', '  padded  ');
    await recordPrompt('s1', '   ');
    expect(await listPrompts('s1')).toEqual(['padded']);
  });

  test('ignores a prompt with no session', async () => {
    await recordPrompt(null, 'orphan');
    expect(await listPrompts(null)).toEqual([]);
  });

  test('drops a repeat of the session\'s newest entry', async () => {
    await recordPrompt('s1', 'same');
    await recordPrompt('s1', 'same');
    const db = await getDb();
    const row = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM prompt_history');
    expect(row?.count).toBe(1);
  });

  test('keeps a repeat that is not the newest entry', async () => {
    await recordPrompt('s1', 'a');
    await recordPrompt('s1', 'b');
    await recordPrompt('s1', 'a');
    expect(await listPrompts('s1')).toEqual(['a', 'b']);
  });
});

describe('listPrompts', () => {
  test('answers newest first', async () => {
    await recordPrompt('s1', 'one');
    await recordPrompt('s1', 'two');
    await recordPrompt('s1', 'three');
    expect(await listPrompts('s1')).toEqual(['three', 'two', 'one']);
  });

  test('scopes to one session', async () => {
    await recordPrompt('s1', 'mine');
    await recordPrompt('s2', 'theirs');
    expect(await listPrompts('s1')).toEqual(['mine']);
  });

  test('merges every session when no session is named', async () => {
    await recordPrompt('s1', 'mine');
    await recordPrompt('s2', 'theirs');
    expect(await listPrompts(null)).toEqual(['theirs', 'mine']);
  });

  test('collapses the same text sent in two sessions to its newest occurrence', async () => {
    await recordPrompt('s1', 'shared');
    await recordPrompt('s2', 'other');
    await recordPrompt('s2', 'shared');
    expect(await listPrompts(null)).toEqual(['shared', 'other']);
  });

  test('honours the limit', async () => {
    await recordPrompt('s1', 'one');
    await recordPrompt('s1', 'two');
    await recordPrompt('s1', 'three');
    expect(await listPrompts('s1', 2)).toEqual(['three', 'two']);
  });
});
