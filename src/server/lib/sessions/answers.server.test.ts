/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { ensureSessionRelationsSchema } from '@/server/lib/sessions/schema.server';
import { loadSessionAnswer, saveSessionAnswer } from '@/server/lib/sessions/answers.server';

beforeEach(async () => {
  await isolateDb();
  await ensureSessionRelationsSchema(await getDb());
});

afterEach(async () => {
  await releaseDb();
});

describe('session answers', () => {
  test('the last answer wins and whitespace-only text is ignored', async () => {
    await saveSessionAnswer('s1', 'first');
    await saveSessionAnswer('s1', '  ');
    expect(await loadSessionAnswer('s1')).toBe('first');
    await saveSessionAnswer('s1', 'second');
    expect(await loadSessionAnswer('s1')).toBe('second');
  });

  test('an unknown session answers null', async () => {
    expect(await loadSessionAnswer('missing')).toBeNull();
  });
});
