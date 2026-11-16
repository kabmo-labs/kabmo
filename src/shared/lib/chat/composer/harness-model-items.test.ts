/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `@harness:<id>:` model rows.
 *
 * The token is what `kabmo session spawn --model` receives, so a wrong shape is
 * a wrong model at spawn time — not a cosmetic bug. A harness with providers
 * (omp) needs `provider/id`; an ACP agent that publishes bare values must not
 * gain a `//` or an `unknown/` prefix.
 */

import { describe, expect, test } from 'bun:test';
import { harnessModelPickItems, harnessModelValue } from '@/shared/lib/chat/composer/harness-model-items';
import type { AIModelOption } from '@/shared/types';

const ompModel: AIModelOption = {
  id: 'deepseek-v4.1-flash',
  name: 'DeepSeek V4.1 Flash',
  provider: 'kenari-jatis',
  contextWindow: 1_000_000,
};

const acpModel: AIModelOption = { id: 'opus', name: 'Opus', provider: '' };

describe('harnessModelValue', () => {
  test('joins provider and id for a provider-publishing harness', () => {
    expect(harnessModelValue(ompModel)).toBe('kenari-jatis/deepseek-v4.1-flash');
  });

  test('leaves a bare ACP value alone', () => {
    expect(harnessModelValue(acpModel)).toBe('opus');
  });
});

describe('harnessModelPickItems', () => {
  test('a row inserts the model value, not the whole mention', () => {
    const [row] = harnessModelPickItems([ompModel], 'omp-rpc');
    if (!row) throw new Error('expected one row');
    expect(row.token).toBe('kenari-jatis/deepseek-v4.1-flash');
    expect(row.name).toBe('DeepSeek V4.1 Flash');
    expect(row.description).toBe('kenari-jatis/deepseek-v4.1-flash · 1000000');
    expect(row.kind).toBe('model');
    expect(row.source).toBe('model');
  });

  test('ids stay unique per harness and per value', () => {
    const rows = harnessModelPickItems([ompModel, acpModel], 'claude');
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    expect(rows[0]?.id).toContain('claude');
  });
});
