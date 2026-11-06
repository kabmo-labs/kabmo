/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `modelFromOption` is the ONE reader of a `model` selector's `currentValue`.
 *
 * It is what the session seeds `runModel` with at start, what every config
 * write adopts, and what `webState()` reports to the generating indicator. The
 * bug it exists to prevent was measured on omp-acp: with no seed, `webState()`
 * answered `{ id: 'kenari-jatis/deepseek-v4-1-flash', provider: 'omp-acp' }` —
 * the harness id in the provider slot and the provider still glued to the model
 * id — because it fell back to the raw string plus `this.harness`.
 */

import { describe, expect, test } from 'bun:test';
import { modelFromOption } from '@/server/lib/harness/acp/prompt';
import type { AcpConfigOption } from '@/server/lib/harness/acp/protocol';

function selector(currentValue: string | undefined): AcpConfigOption {
  return {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    ...(currentValue === undefined ? {} : { currentValue }),
    options: [],
  };
}

describe('modelFromOption', () => {
  test('splits provider and model id on the first slash', () => {
    expect(modelFromOption(selector('kenari-jatis/deepseek-v4-1-flash'), 'omp-acp')).toEqual({
      provider: 'kenari-jatis',
      modelId: 'deepseek-v4-1-flash',
    });
  });

  test('keeps a slash inside the model id', () => {
    expect(modelFromOption(selector('openai/gpt-5.1/codex'), 'omp-acp')).toEqual({
      provider: 'openai',
      modelId: 'gpt-5.1/codex',
    });
  });

  test('a value with no slash names no provider, so the caller supplies one', () => {
    expect(modelFromOption(selector('gpt-5.1'), 'omp-acp')).toEqual({
      provider: 'omp-acp',
      modelId: 'gpt-5.1',
    });
  });

  test('an absent selector or an empty value answers null', () => {
    expect(modelFromOption(undefined, 'omp-acp')).toBeNull();
    expect(modelFromOption(selector(undefined), 'omp-acp')).toBeNull();
    expect(modelFromOption(selector(''), 'omp-acp')).toBeNull();
  });
});
