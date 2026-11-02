/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The project default-model value.
 *
 * The failure this guards is silent: a bare display name or an id without its
 * provider parses to a "model" that either no provider serves or that resolves
 * to whichever provider happens to come first, and the chat then starts on a
 * model the project never asked for.
 */

import { describe, expect, test } from 'bun:test';

import {
  NO_PROJECT_MODEL,
  parseProjectModel,
  projectModelLabel,
  projectModelValue,
} from '@/shared/lib/workspace/project-model';

describe('parseProjectModel', () => {
  test('reads a composite provider:model value', () => {
    expect(parseProjectModel('kenari:deepseek-v4-flash')).toEqual({
      provider: 'kenari',
      modelId: 'deepseek-v4-flash',
    });
  });

  test('trims both halves and keeps an id that carries a colon', () => {
    expect(parseProjectModel('  openrouter : vendor/model:x  ')).toEqual({
      provider: 'openrouter',
      modelId: 'vendor/model:x',
    });
  });

  test('the schema default and a legacy display name both read as "inherit"', () => {
    expect(parseProjectModel(NO_PROJECT_MODEL)).toBeNull();
    expect(parseProjectModel('GPT-4o')).toBeNull();
    expect(parseProjectModel('DeepSeek-V3')).toBeNull();
  });

  test('malformed values never become a half-named model', () => {
    expect(parseProjectModel('')).toBeNull();
    expect(parseProjectModel('   ')).toBeNull();
    expect(parseProjectModel(':gpt')).toBeNull();
    expect(parseProjectModel('gpt:')).toBeNull();
    expect(parseProjectModel(null)).toBeNull();
    expect(parseProjectModel(42)).toBeNull();
  });
});

describe('projectModelValue / projectModelLabel', () => {
  test('round-trips through the composite value', () => {
    const value = projectModelValue({ provider: 'kenari', modelId: 'deepseek-v4-flash' });
    expect(value).toBe('kenari:deepseek-v4-flash');
    expect(parseProjectModel(value)).toEqual({ provider: 'kenari', modelId: 'deepseek-v4-flash' });
  });

  test('a stored model the catalog still serves is labelled with its display name', () => {
    expect(
      projectModelLabel('kenari:deepseek-v4-flash', [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'kenari' },
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash (direct)', provider: 'deepseek' },
      ]),
    ).toBe('kenari · DeepSeek V4 Flash');
  });

  test('a stale stored model is still named, so it does not read as "inherit"', () => {
    expect(projectModelLabel('kenari:gone', [])).toBe('kenari · gone');
  });

  test('an unset value has no label', () => {
    expect(projectModelLabel(NO_PROJECT_MODEL, [])).toBeNull();
    expect(projectModelLabel('', [])).toBeNull();
  });
});
