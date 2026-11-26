import { describe, expect, test } from 'bun:test';

import type { DbClient } from '@kabmo-labs/kabmo-db/client';
import { isPlainObject, mergeSettingsJson, readSettingsJson } from '@kabmo-labs/kabmo-settings/store';

/** Minimal in-memory stand-in for the `app_settings` rows the store talks to. */
function fakeDb(rows: Record<string, string> = {}) {
  const store = new Map(Object.entries(rows));
  const db = {
    async get(_sql: string, params: unknown[] = []) {
      const value = store.get(String(params[0]));
      return value === undefined ? undefined : { value };
    },
    async run(_sql: string, params: unknown[] = []) {
      store.set(String(params[0]), String(params[1]));
      return { changes: 1, lastID: 0 };
    },
  };
  // Only `get`/`run` are reachable from the store; the rest of `DbClient` exists
  // for callers this test never exercises.
  return { db: db as unknown as DbClient, read: (key: string) => store.get(key) };
}

const KEY = 'omp_chamber_settings';

describe('mergeSettingsJson', () => {
  test('applies the patch and keeps the keys it did not name', async () => {
    const { db, read } = fakeDb({ [KEY]: JSON.stringify({ theme: 'paper', soundAlerts: true }) });
    await mergeSettingsJson(db, KEY, { theme: 'nord-dark' });
    expect(JSON.parse(read(KEY)!)).toEqual({ theme: 'nord-dark', soundAlerts: true });
  });

  test('creates the row when it is absent or not an object', async () => {
    const absent = fakeDb();
    await mergeSettingsJson(absent.db, KEY, { theme: 'nord-dark' });
    expect(JSON.parse(absent.read(KEY)!)).toEqual({ theme: 'nord-dark' });

    const array = fakeDb({ [KEY]: JSON.stringify(['stale']) });
    await mergeSettingsJson(array.db, KEY, { theme: 'nord-dark' });
    expect(JSON.parse(array.read(KEY)!)).toEqual({ theme: 'nord-dark' });

    const malformed = fakeDb({ [KEY]: 'not json' });
    await mergeSettingsJson(malformed.db, KEY, { theme: 'nord-dark' });
    expect(JSON.parse(malformed.read(KEY)!)).toEqual({ theme: 'nord-dark' });
  });

  test('a patch cannot resurrect a value from a stale copy of its siblings', async () => {
    // Two writers, one blob: only the key each of them edited is stored.
    const { db, read } = fakeDb({ [KEY]: JSON.stringify({ theme: 'paper' }) });
    await mergeSettingsJson(db, KEY, { theme: 'nord-dark' });
    await mergeSettingsJson(db, KEY, { chatCompletionSound: false });
    expect(JSON.parse(read(KEY)!)).toEqual({ theme: 'nord-dark', chatCompletionSound: false });
    expect(await readSettingsJson(db, KEY, {})).toEqual({ theme: 'nord-dark', chatCompletionSound: false });
  });
});

describe('isPlainObject', () => {
  test('accepts objects and rejects the shapes that must replace instead of merge', () => {
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(['a'])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject('a')).toBe(false);
    expect(isPlainObject(7)).toBe(false);
  });
});
