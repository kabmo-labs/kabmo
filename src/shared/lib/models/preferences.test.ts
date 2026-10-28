/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The preference rules are shared verbatim by the server (which persists the
 * arrays) and the picker (which applies them optimistically), so these lock the
 * behaviour both sides read back: composite keys, most-recent-first order, and
 * the five-entry cap.
 */

import { describe, expect, test } from 'bun:test';

import {
  EMPTY_MODEL_PREFERENCES,
  RECENT_MODELS_LIMIT,
  applyModelPreferences,
  filterKnownKeys,
  readModelPreferences,
  recordRecentKey,
  toggleFavoriteKey,
} from '@/shared/lib/models/preferences';
import type { AIModelOption } from '@/shared/types';

describe('toggleFavoriteKey', () => {
  test('adds an unknown key at the end and removes a known one', () => {
    expect(toggleFavoriteKey(['a:1'], 'b:2')).toEqual(['a:1', 'b:2']);
    expect(toggleFavoriteKey(['a:1', 'b:2'], 'a:1')).toEqual(['b:2']);
  });

  test('keys on provider + id, so the same id under another provider is a separate favorite', () => {
    // The registry serves `deepseek-v4-pro` from both `deepseek` and `kenari`.
    // An id-only list would unstar both rows when either is clicked.
    const favorites = toggleFavoriteKey([], 'deepseek:deepseek-v4-pro');
    expect(toggleFavoriteKey(favorites, 'kenari:deepseek-v4-pro')).toEqual([
      'deepseek:deepseek-v4-pro',
      'kenari:deepseek-v4-pro',
    ]);
  });
});

describe('recordRecentKey', () => {
  test('moves a re-picked model to the front instead of duplicating it', () => {
    expect(recordRecentKey(['a:1', 'b:2', 'c:3'], 'b:2')).toEqual(['b:2', 'a:1', 'c:3']);
  });

  test('caps the list at five, evicting the oldest entry', () => {
    const full = ['a:1', 'b:2', 'c:3', 'd:4', 'e:5'];
    const next = recordRecentKey(full, 'f:6');

    expect(next).toHaveLength(RECENT_MODELS_LIMIT);
    expect(next[0]).toBe('f:6');
    expect(next).not.toContain('e:5');
  });

  test('re-picking inside a full list keeps the other four', () => {
    const full = ['a:1', 'b:2', 'c:3', 'd:4', 'e:5'];
    expect(recordRecentKey(full, 'c:3')).toEqual(['c:3', 'a:1', 'b:2', 'd:4', 'e:5']);
  });
});

describe('readModelPreferences', () => {
  test('reads a well-formed pair', () => {
    expect(readModelPreferences({ favorites: ['a:1'], recentKeys: ['b:2'] }))
      .toEqual({ favorites: ['a:1'], recentKeys: ['b:2'] });
  });

  test('drops non-string entries and caps an over-long recent list', () => {
    const raw = {
      favorites: ['a:1', 7, null, ''],
      recentKeys: ['a:1', 'b:2', 'c:3', 'd:4', 'e:5', 'f:6', 'g:7'],
    };

    expect(readModelPreferences(raw)).toEqual({
      favorites: ['a:1'],
      recentKeys: ['a:1', 'b:2', 'c:3', 'd:4', 'e:5'],
    });
  });

  test('an absent or malformed row yields empty rails', () => {
    expect(readModelPreferences(null)).toEqual(EMPTY_MODEL_PREFERENCES);
    expect(readModelPreferences('nonsense')).toEqual(EMPTY_MODEL_PREFERENCES);
    expect(readModelPreferences({ favorites: 'not-a-list' })).toEqual(EMPTY_MODEL_PREFERENCES);
  });
});

describe('filterKnownKeys', () => {
  test('drops keys the registry no longer serves', () => {
    // A model removed from models.yml, or every model of a disconnected
    // provider, must not hold a slot in the five-entry rail.
    const known = new Set(['a:1', 'c:3']);
    expect(filterKnownKeys(['a:1', 'gone:9', 'c:3'], known)).toEqual(['a:1', 'c:3']);
  });

  test('pruning before a write frees the slot instead of merely hiding it', () => {
    // The rail reads at most five entries. A stale key left in the stored array
    // occupies one of them across every reload, so the user sees four models
    // and the fifth pick appears to do nothing.
    const stored = ['gone:9', 'a:1', 'b:2', 'c:3', 'd:4'];
    const pruned = recordRecentKey(filterKnownKeys(stored, new Set(['a:1', 'b:2', 'c:3', 'd:4', 'e:5'])), 'e:5');

    expect(pruned).toEqual(['e:5', 'a:1', 'b:2', 'c:3', 'd:4']);
    expect(pruned).toHaveLength(RECENT_MODELS_LIMIT);
  });
});

describe('applyModelPreferences', () => {
  const rows: AIModelOption[] = [
    { id: '1', name: 'One', provider: 'a' },
    { id: '2', name: 'Two', provider: 'a', isFavorite: true },
    { id: '3', name: 'Three', provider: 'b' },
  ];

  test('lights only the rows named by the stored key list', () => {
    const applied = applyModelPreferences(rows, { favorites: ['b:3'], recentKeys: [] });

    // Truthiness is the contract the star reads: a registry row has no
    // `isFavorite` field at all, so `false` and `undefined` both mean "unlit".
    expect(applied.map((m) => Boolean(m.isFavorite))).toEqual([false, false, true]);
  });

  test('leaves already-correct rows identical so only the changed row re-renders', () => {
    const applied = applyModelPreferences(rows, { favorites: [], recentKeys: [] });

    expect(applied[0]).toBe(rows[0]);
    expect(applied[2]).toBe(rows[2]);
    expect(applied[1]).not.toBe(rows[1]);
    expect(applied[1].isFavorite).toBe(false);
  });
});
