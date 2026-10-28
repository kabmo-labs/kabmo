/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The seed a hand-entered model becomes.
 *
 * The Add Model dialog is the only writer whose values come from a person
 * rather than a provider listing, so it is the only one that can carry a
 * mistake into models.yml. omp's failure mode is what makes that expensive: one
 * bad entry makes it disable EVERY custom provider in the file, so a
 * non-positive limit or a half-filled price has to be dropped here rather than
 * validated after the fact.
 */

import { describe, expect, test } from 'bun:test';

import { manualModelSeed, toModelEntry } from '@/server/lib/omp/config/provider-seeds';
import { validateModelsDocument, sanitizeModelEntry } from '@/server/lib/omp/config/models-validation';

describe('manualModelSeed', () => {
  test('keeps the metadata the user entered', () => {
    expect(manualModelSeed({
      id: 'my-model',
      name: 'My Model',
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: true,
      imageInput: true,
      costInput: 0.5,
      costOutput: 1.5,
      costCacheRead: 0.05,
      costCacheWrite: 0.1,
    })).toEqual({
      id: 'my-model',
      name: 'My Model',
      reasoning: true,
      imageInput: true,
      contextWindow: 200000,
      maxTokens: 8192,
      cost: { input: 0.5, output: 1.5, cacheRead: 0.05, cacheWrite: 0.1 },
    });
  });

  test('an id alone is a valid entry', () => {
    // The common case is "add this id I know exists" — every other field is
    // metadata omp can work without, so requiring them would block it.
    expect(manualModelSeed({ id: '  bare-id  ' })).toEqual({ id: 'bare-id' });
  });

  test('drops non-positive limits instead of writing them', () => {
    // omp rejects contextWindow/maxTokens <= 0 outright, which takes every
    // custom provider down with it.
    const seed = manualModelSeed({ id: 'm', contextWindow: 0, maxTokens: -1 });
    expect(seed.contextWindow).toBeUndefined();
    expect(seed.maxTokens).toBeUndefined();
  });

  test('rounds fractional token counts', () => {
    expect(manualModelSeed({ id: 'm', contextWindow: 128000.7 }).contextWindow).toBe(128001);
  });

  test('writes a price only when both sides are known', () => {
    // omp's schema requires all four cost fields together; half a price would
    // be a schema violation, not a partial price.
    expect(manualModelSeed({ id: 'm', costInput: 1 }).cost).toBeUndefined();
    expect(manualModelSeed({ id: 'm', costOutput: 1 }).cost).toBeUndefined();
    expect(manualModelSeed({ id: 'm', costInput: 1, costOutput: 2 }).cost)
      .toEqual({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0 });
  });

  test('a seed the user entered produces a document omp accepts', () => {
    const seed = manualModelSeed({
      id: 'my-model',
      name: 'My Model',
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: true,
      costInput: 0,
      costOutput: 0,
    });
    const entry = sanitizeModelEntry({
      id: seed.id,
      ...(seed.name ? { name: seed.name } : {}),
      ...(seed.reasoning !== undefined ? { reasoning: seed.reasoning } : {}),
      input: ['text'],
      ...(seed.contextWindow ? { contextWindow: seed.contextWindow } : {}),
      ...(seed.maxTokens ? { maxTokens: seed.maxTokens } : {}),
      ...(seed.cost ? { cost: seed.cost } : {}),
    });
    expect(validateModelsDocument({
      providers: {
        p: { baseUrl: 'https://x/v1', apiKey: 'k', api: 'openai-completions', models: [entry] },
      },
    })).toEqual([]);
  });
});

describe('manualModelSeed — reasoning ladder', () => {
  test('declares the ladder the user ticked, in omp order', () => {
    expect(manualModelSeed({
      id: 'm',
      reasoning: true,
      efforts: ['high', 'low'],
    }).efforts).toEqual(['high', 'low']);
  });

  test('an empty ladder is not declared', () => {
    // omp already assumes its own default ladder for a reasoning model, so an
    // empty list would write a block that changes nothing.
    expect(manualModelSeed({ id: 'm', reasoning: true, efforts: [] }).efforts).toBeUndefined();
  });

  test('a ladder without reasoning is dropped', () => {
    // A capability the user did not enable must not be declared; omp would
    // advertise levels for a model it is told cannot reason.
    expect(manualModelSeed({ id: 'm', efforts: ['high'] }).efforts).toBeUndefined();
  });

  test('a repeated level is collapsed', () => {
    expect(manualModelSeed({ id: 'm', reasoning: true, efforts: ['low', 'low'] }).efforts).toEqual(['low']);
  });

  test('the written entry carries thinking.mode and omp accepts it', () => {
    const seed = manualModelSeed({ id: 'm', reasoning: true, efforts: ['low', 'high'] });
    const entry = toModelEntry(seed);
    expect(entry.thinking).toEqual({ mode: 'effort', efforts: ['low', 'high'] });
    expect(validateModelsDocument({
      providers: { p: { baseUrl: 'https://x/v1', apiKey: 'k', api: 'openai-completions', models: [entry] } },
    })).toEqual([]);
  });

  test('a model without a ladder writes no thinking block at all', () => {
    expect(toModelEntry(manualModelSeed({ id: 'm', reasoning: true })).thinking).toBeUndefined();
  });
});

describe('validateModelsDocument — thinking', () => {
  test('refuses a ladder omp does not know', () => {
    const errors = validateModelsDocument({
      providers: {
        p: { baseUrl: 'https://x/v1', apiKey: 'k', api: 'openai-completions',
          models: [{ id: 'm', reasoning: true, thinking: { mode: 'effort', efforts: ['off'] } }] },
      },
    });
    expect(errors.some((error) => error.includes('unknown thinking effort'))).toBe(true);
  });

  test('refuses a thinking block with no mode', () => {
    // omp's own error for this is a schema failure that disables every custom
    // provider, so it must never reach the file.
    const errors = validateModelsDocument({
      providers: {
        p: { baseUrl: 'https://x/v1', apiKey: 'k', api: 'openai-completions',
          models: [{ id: 'm', reasoning: true, thinking: { efforts: ['low'] } }] },
      },
    });
    expect(errors.some((error) => error.includes('"thinking.mode" is required'))).toBe(true);
  });

  test('sanitize drops an unusable thinking block rather than the model', () => {
    const entry = sanitizeModelEntry({ id: 'm', reasoning: true, thinking: { mode: 'nope', efforts: ['low'] } });
    expect(entry.thinking).toBeUndefined();
    expect(entry.id).toBe('m');
  });
});
