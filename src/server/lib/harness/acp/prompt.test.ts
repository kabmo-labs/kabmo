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
import { applyLaunchSelections, applySelections, modelFromOption } from '@/server/lib/harness/acp/prompt';
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

describe('modelFromOption — agent spellings', () => {
  test('a stringified [provider, id] array is read as provider/model', () => {
    // deepseek-harness-acp publishes exactly this; without the normalisation the
    // run indicator named the harness as provider and the array as the model.
    expect(modelFromOption(selector('["deepseek-official","deepseek-v4-flash"]'), 'dsh')).toEqual({
      provider: 'deepseek-official',
      modelId: 'deepseek-v4-flash',
    });
  });

  test('a JSON array that is not a pair keeps the agent spelling', () => {
    expect(modelFromOption(selector('["only-one"]'), 'dsh')).toEqual({
      provider: 'dsh',
      modelId: '["only-one"]',
    });
    expect(modelFromOption(selector('[1,2]'), 'dsh')).toEqual({ provider: 'dsh', modelId: '[1,2]' });
    expect(modelFromOption(selector('[broken'), 'dsh')).toEqual({ provider: 'dsh', modelId: '[broken' });
  });
});

describe('applySelections', () => {
  const option = (id: string, category: string, values: string[]): AcpConfigOption => ({
    id,
    category,
    type: 'select',
    currentValue: values[0],
    options: values.map((value) => ({ value })),
  });

  test('writes each selector by its own id, not by its category', async () => {
    // ACP allows any id; `session/set_config_option` keys on it. Writing
    // "model"/"thinking"/"mode" happened to work only for agents whose ids
    // matched those words.
    const writes: [string, string | boolean][] = [];
    await applySelections(
      {
        configOptions: [
          option('sel-model', 'model', ['p/m']),
          option('sel-think', 'thought_level', ['low', 'high']),
          option('sel-mode', 'mode', ['default', 'plan']),
        ],
        runModel: null,
        setConfig: async (id, value) => {
          writes.push([id, value]);
        },
      },
      { model: { provider: 'p', modelId: 'm' }, thinking: 'high', mode: 'plan' },
    );
    expect(writes).toEqual([
      ['sel-model', 'p/m'],
      ['sel-think', 'high'],
      ['sel-mode', 'plan'],
    ]);
  });

  test('a value the agent does not offer is skipped, never invented', async () => {
    const writes: string[] = [];
    await applySelections(
      {
        configOptions: [option('sel-think', 'thought_level', ['low'])],
        runModel: null,
        setConfig: async (id) => {
          writes.push(id);
        },
      },
      { model: null, thinking: 'max', mode: null },
    );
    expect(writes).toEqual([]);
  });

  test('a matched model the agent refuses fails the spawn with its reason', async () => {
    // dsh answered `unknown model option` when its configured provider was no
    // longer in the live list. Swallowing it ran the turn on the agent's own
    // default provider, and the first prompt's error named neither the model nor
    // the refused write.
    await expect(applySelections(
      {
        harness: 'dsh',
        configOptions: [option('sel-model', 'model', ['["kenari","qwen3-8-27b:free"]'])],
        runModel: null,
        setConfig: async () => {
          throw new Error('Invalid params: unknown model option');
        },
      },
      // dsh stores its selector as a stringified pair, so the configured
      // default is a provider-less id. That is the spelling this write uses.
      { model: { provider: '', modelId: '["kenari","qwen3-8-27b:free"]' }, thinking: null, mode: null },
    )).rejects.toThrow('dsh refused model "["kenari","qwen3-8-27b:free"]"');
  });
});

describe('applyLaunchSelections', () => {
  const legacy = (modeIds: string[]): AcpConfigOption => ({
    id: 'mode',
    category: 'mode',
    type: 'select',
    currentValue: modeIds[0],
    options: modeIds.map((value) => ({ value })),
  });

  test('a mode selector is written through setConfig, not set_mode', async () => {
    const writes: string[] = [];
    const setModes: string[] = [];
    await applyLaunchSelections(
      {
        configOptions: [legacy(['default', 'plan'])],
        runModel: null,
        setConfig: async (id, value) => {
          writes.push(`${id}=${String(value)}`);
        },
        setMode: async (mode) => {
          setModes.push(mode);
        },
      },
      { model: null, thinking: null, mode: 'plan' },
    );
    expect(writes).toEqual(['mode=plan']);
    // The config selector supersedes the older list: calling both would write
    // the same mode twice, in two different verbs.
    expect(setModes).toEqual([]);
  });

  test('an agent with only the older modes list moves through set_mode', async () => {
    // This is the branch the claim relies on: a prewarmed session handshaked
    // with no picks, so the mode the operator chose arrives here, one write
    // after the fact.
    const setModes: string[] = [];
    await applyLaunchSelections(
      {
        configOptions: [],
        modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }, { id: 'plan', name: 'Plan' }] },
        runModel: null,
        setConfig: async () => {},
        setMode: async (mode) => {
          setModes.push(mode);
        },
      },
      { model: null, thinking: null, mode: 'plan' },
    );
    expect(setModes).toEqual(['plan']);
  });

  test('a mode the agent never advertised is not written', async () => {
    const setModes: string[] = [];
    await applyLaunchSelections(
      {
        configOptions: [],
        modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }] },
        runModel: null,
        setConfig: async () => {},
        setMode: async (mode) => {
          setModes.push(mode);
        },
      },
      { model: null, thinking: null, mode: 'architect' },
    );
    expect(setModes).toEqual([]);
  });
});
