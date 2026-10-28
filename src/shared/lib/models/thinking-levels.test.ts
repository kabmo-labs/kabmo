/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Thinking-level resolution for the composer's selector. Two silent failures
 * matter: injecting a generic ladder for a model that exposes none offers the
 * user efforts the model cannot honour, and attributing the LIVE session
 * model's ladder to a different selected model (a disabled/renamed provider
 * falls back to the default model) lists the wrong efforts. These pin the
 * ordering, the empty-ladder contract, and the exact-match requirement between
 * the selected model and the live metadata.
 */

import { describe, expect, test } from 'bun:test';

import {
  normalizeThinkingLevel,
  resolveAvailableThinkingLevels,
  selectableThinkingLevels,
  thinkingLevelsForMeta,
} from '@/shared/lib/models/thinking-levels';
import type { ThinkingModelMeta } from '@/shared/types';

describe('selectableThinkingLevels', () => {
  test('orders the model ladder by the familiar sequence, keeping extras', () => {
    expect(selectableThinkingLevels(['high', 'low', 'turbo', 'minimal'])).toEqual(['minimal', 'low', 'high', 'turbo']);
  });

  test('drops the injected "auto" but keeps "off"', () => {
    expect(selectableThinkingLevels(['auto', 'off', 'high'])).toEqual(['off', 'high']);
  });

  test('an absent or empty ladder stays empty — no generic fallback', () => {
    // An empty result is how callers learn to disable the selector.
    expect(selectableThinkingLevels([])).toEqual([]);
    expect(selectableThinkingLevels(null)).toEqual([]);
    expect(selectableThinkingLevels(undefined)).toEqual([]);
  });

  test('blank entries are dropped', () => {
    expect(selectableThinkingLevels(['', 'high'])).toEqual(['high']);
  });
});

describe('thinkingLevelsForMeta', () => {
  test('a non-reasoning model offers only off', () => {
    expect(thinkingLevelsForMeta({ provider: 'p', modelId: 'm', reasoning: false })).toEqual(['off']);
    expect(thinkingLevelsForMeta({ provider: 'p', modelId: 'm' })).toEqual(['off']);
  });

  test('a reasoning model puts off first, then its declared efforts', () => {
    expect(thinkingLevelsForMeta({ provider: 'p', modelId: 'm', reasoning: true, thinking: { efforts: ['low', 'high'] } })).toEqual([
      'off',
      'low',
      'high',
    ]);
  });

  test('a reasoning model with no declared ladder still offers off', () => {
    expect(thinkingLevelsForMeta({ provider: 'p', modelId: 'm', reasoning: true })).toEqual(['off']);
  });
});

describe('normalizeThinkingLevel', () => {
  test('a concrete level passes through trimmed', () => {
    expect(normalizeThinkingLevel(' high ')).toBe('high');
  });

  test('null, undefined and blank collapse to off', () => {
    expect(normalizeThinkingLevel(null)).toBe('off');
    expect(normalizeThinkingLevel(undefined)).toBe('off');
    expect(normalizeThinkingLevel('   ')).toBe('off');
    expect(normalizeThinkingLevel(7)).toBe('off');
  });
});

describe('resolveAvailableThinkingLevels', () => {
  const live: ThinkingModelMeta = { provider: 'p', modelId: 'm', reasoning: true, thinking: { efforts: ['low'] } };

  test('the catalog ladder wins when it has entries', () => {
    expect(resolveAvailableThinkingLevels(['off', 'high'], { provider: 'p', modelId: 'm' }, live)).toEqual(['off', 'high']);
  });

  test('a non-catalog model is backed by the live metadata when it matches', () => {
    expect(resolveAvailableThinkingLevels(undefined, { provider: 'p', modelId: 'm' }, live)).toEqual(['off', 'low']);
    expect(resolveAvailableThinkingLevels([], { provider: 'p', modelId: 'm' }, live)).toEqual(['off', 'low']);
  });

  test('a mismatched live model is not used — the result is null', () => {
    // A disabled/renamed provider falls back to a different default model; its
    // ladder must not be attributed to the selected one.
    expect(resolveAvailableThinkingLevels(undefined, { provider: 'p', modelId: 'other' }, live)).toBeNull();
    expect(resolveAvailableThinkingLevels(undefined, { provider: 'q', modelId: 'm' }, live)).toBeNull();
  });

  test('no model or no live metadata is null', () => {
    expect(resolveAvailableThinkingLevels(undefined, null, live)).toBeNull();
    expect(resolveAvailableThinkingLevels(undefined, { provider: 'p', modelId: 'm' }, null)).toBeNull();
  });
});
