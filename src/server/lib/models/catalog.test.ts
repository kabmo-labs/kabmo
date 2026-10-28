/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The catalog row → panel model projection.
 *
 * The panel used to read `get_available_models`, which answers CHAT models only
 * and drops `kind`, `thinking`, `input` and `cost`. Every row therefore read
 * `hasVision: false` / `hasTools: true` whatever omp knew, and an embedding or
 * image model could not be listed at all.
 */

import { describe, expect, test } from 'bun:test';
import { catalogContextLabel, toCatalogModel } from '@/server/lib/models/catalog.server';

describe('toCatalogModel', () => {
  test('carries the kind, the ladder and the price omp reports', () => {
    const model = toCatalogModel({
      provider: 'gateway',
      id: 'gpt-x',
      name: 'GPT X',
      kind: 'image',
      selector: 'gateway/gpt-x',
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: true,
      thinking: { mode: 'effort', efforts: ['low', 'high'] },
      input: ['text', 'image'],
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      pricingStatus: 'exact',
    });

    expect(model).not.toBeNull();
    expect(model?.kind).toBe('image');
    expect(model?.reasoning).toBe(true);
    expect(model?.thinking).toEqual({ mode: 'effort', efforts: ['low', 'high'] });
    expect(model?.input).toEqual(['text', 'image']);
    expect(model?.cost).toEqual({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
    expect(model?.pricingStatus).toBe('exact');
  });

  test('an absent kind is chat, which is omp’s own default', () => {
    expect(toCatalogModel({ provider: 'p', id: 'm' })?.kind).toBe('chat');
  });

  test('a half-reported price is not a price', () => {
    // omp requires all four cost fields together; a badge built on an input-only
    // rate would print `$3 / $?` as if it were an accounting.
    const model = toCatalogModel({ provider: 'p', id: 'm', cost: { input: 3 } });
    expect(model?.cost).toBeUndefined();
  });

  test('a row without a provider or id is unusable', () => {
    expect(toCatalogModel({ id: 'm' })).toBeNull();
    expect(toCatalogModel({ provider: 'p' })).toBeNull();
  });

  test('a retyped field degrades the row, not the listing', () => {
    const model = toCatalogModel({
      provider: 'p',
      id: 'm',
      name: 42,
      contextWindow: 'lots',
      input: 'text',
      thinking: { efforts: 'high' },
    });
    expect(model?.name).toBe('m');
    expect(model?.contextWindow).toBeUndefined();
    expect(model?.input).toEqual([]);
    expect(model?.thinking).toBeUndefined();
  });
});

describe('catalogContextLabel', () => {
  test('reads as the badge the rows print', () => {
    expect(catalogContextLabel({ contextWindow: 200000, maxTokens: 8192 })).toContain('ctx');
    expect(catalogContextLabel({ contextWindow: 200000, maxTokens: 8192 })).toContain('out');
    expect(catalogContextLabel({ contextWindow: 200000 })).not.toContain('out');
    expect(catalogContextLabel({})).toBe('');
  });
});
