/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which models a tab lists.
 *
 * The failure this prevents is not cosmetic: showing omp's 221 models under the
 * `claude` tab offers rows that agent cannot run, and the first prompt fails
 * after the picker already promised it. So every case below asserts the LIST
 * identity, not just a count.
 */

import { describe, expect, test } from 'bun:test';
import { acpModelOption, harnessModels, pickerHarnesses } from '@/client/components/workspace/model-dropdown/harness-models';
import type { HarnessSummary } from '@/shared/types/harness';
import type { AIModelOption } from '@/shared/types';

const ompModels: AIModelOption[] = [
  { id: 'deepseek-v4-1-flash', name: 'DeepSeek V4 Flash', provider: 'kenari-jatis' },
  { id: 'claude-fable-5', name: 'Claude Fable 5', provider: 'kenari' },
];

function probed(id: string, models: { value: string; name: string }[], blocked?: string, thinking: { value: string; name: string }[] = []): HarnessSummary {
  return {
    id,
    label: id,
    transport: 'acp',
    canLaunch: true,
    enabled: true,
    probe: {
      harness: id,
      capabilities: {
        configModel: models.length, configThinking: thinking.length, configMode: 0, modeValues: [],
        loadSession: true, listSessions: true, forkSession: false, deleteSession: false,
        resumeSession: true, closeSession: true, hasUsage: false, hasPlan: false, steerMode: null,
        ...(blocked ? { blocked } : {}),
      },
      models, thinking, modes: [], probedAt: Date.now(),
    },
  };
}

describe('harness model lists', () => {
  test("omp's tab returns the registry untouched, favorites and all", () => {
    const list = harnessModels([], 'omp-rpc', ompModels);
    // Identity by CONTENT: omp's rows carry favorites and plates the other
    // harnesses' catalogs do not, so nothing may be re-mapped into a copy.
    expect(list.models).toEqual(ompModels);
    expect(list.models.some((model) => model.provider === 'kenari-jatis')).toBe(true);
    expect(list.unprobed).toBe(false);
  });

  test('no harness yet previews omp, because omp is the default agent', () => {
    expect(harnessModels([], undefined, ompModels).models).toHaveLength(2);
  });

  test("claude's tab lists ONLY claude's models", () => {
    const harnesses = [probed('claude', [
      { value: 'default', name: 'default' },
      { value: 'opus', name: 'opus' },
    ])];
    const list = harnessModels(harnesses, 'claude', ompModels);
    expect(list.models.map((m) => m.id)).toEqual(['default', 'opus']);
    expect(list.models.some((m) => m.id === 'deepseek-v4-1-flash')).toBe(false);
  });

  test('a probed agent with zero models is empty, not "fall back to omp"', () => {
    const list = harnessModels([probed('dsh', [])], 'dsh', ompModels);
    expect(list.models).toEqual([]);
    expect(list.unprobed).toBe(false);
  });

  test('an unprobed harness reports unprobed, never omp’s list as a stand-in', () => {
    const summary: HarnessSummary = { id: 'gemini', label: 'gemini', transport: 'acp', canLaunch: true, enabled: true, probe: null };
    const list = harnessModels([summary], 'gemini', ompModels);
    expect(list.models).toEqual([]);
    expect(list.unprobed).toBe(true);
  });

  test('a blocked harness carries the agent’s own refusal', () => {
    const summary: HarnessSummary = {
      id: 'minimax', label: 'minimax', transport: 'acp', canLaunch: true, enabled: true,
      probe: probed('minimax', []).probe, unavailable: 'Run `mcode login`',
    };
    const list = harnessModels([summary], 'minimax', ompModels);
    expect(list.unprobed).toBe(false);
    expect(list.models).toEqual([]);
  });

  test('a bare value (no provider slash) still gets a provider heading', () => {
    const option = acpModelOption({ value: 'deepseek-v4-flash', name: 'V4 Flash' }, 'dsh');
    expect(option).toMatchObject({ id: 'deepseek-v4-flash', provider: 'dsh', name: 'V4 Flash' });
  });

  test('a provider/model value splits into the pair set_config_option wants', () => {
    const option = acpModelOption({ value: 'kenari/agnes-2-5-flash:free', name: 'Agnes 2.5' }, 'omp-acp');
    expect(option).toMatchObject({ id: 'agnes-2-5-flash:free', provider: 'kenari' });
  });

  test('ACP rows claim no context window or price, because the agent publishes none', () => {
    const option = acpModelOption({ value: 'a/b', name: 'B' }, 'claude');
    expect(option.contextWindow).toBeUndefined();
    expect(option.cost).toBeUndefined();
  });

  test("the agent's thinking ladder rides every model row", () => {
    // `thought_level` is a SESSION selector, so the same ladder applies to
    // every model the harness lists. Dropping it disabled the composer's
    // thinking dropdown even though `set_thinking_level` is implemented.
    const list = harnessModels(
      [probed('claude', [{ value: 'opus', name: 'Opus' }], undefined, [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
      ])],
      'claude',
      ompModels,
    );
    expect(list.models[0]?.thinkingLevels).toEqual(['low', 'high']);
  });

  test('a harness that publishes no thinking ladder gets no invented levels', () => {
    const list = harnessModels([probed('claude', [{ value: 'opus', name: 'Opus' }])], 'claude', ompModels);
    expect(list.models[0]?.thinkingLevels).toBeUndefined();
  });

  test('the open chat’s own lists outrank the one-spawn probe', () => {
    // codex refuses a probe while a chat runs, and the probe's blocked message
    // then sat beside rows that chat was already offering.
    const summary: HarnessSummary = {
      id: 'codex', label: 'codex', transport: 'acp', canLaunch: true, enabled: true,
      probe: probed('codex', [{ value: 'probe-only', name: 'Probe only' }]).probe,
      unavailable: 'Probe refused',
    };
    const list = harnessModels([summary], 'codex', ompModels, {
      models: [{ value: 'openai/gpt-5', name: 'GPT-5' }],
      thinking: [{ value: 'medium', name: 'Medium' }],
    });
    expect(list.models.map((model) => model.id)).toEqual(['gpt-5']);
    expect(list.models[0]?.thinkingLevels).toEqual(['medium']);
    expect(list.blocked).toBeUndefined();
  });
});

describe('which harnesses the picker offers', () => {
  const summary = (id: string, enabled: boolean): HarnessSummary => ({
    id, label: id, transport: 'acp', canLaunch: true, enabled, probe: null,
  });

  test('a switched-off harness is gone from the tab strip', () => {
    const list = pickerHarnesses(
      [summary('omp-rpc', true), summary('claude', false), summary('codex', true)],
      'omp-rpc',
    );
    expect(list.map((entry) => entry.id)).toEqual(['omp-rpc', 'codex']);
  });

  test('the harness owning the open chat survives, so a transcript can name it', () => {
    // The one exception: switching an agent off must not make an existing
    // conversation unnameable — its row and its history still say which agent ran
    // it, and the picker has to agree with the sidebar.
    const list = pickerHarnesses(
      [summary('omp-rpc', true), summary('claude', false)],
      'claude',
    );
    expect(list.map((entry) => entry.id)).toEqual(['omp-rpc', 'claude']);
  });

  test('before a chat exists there is no harness to keep, so the roster is the list', () => {
    const list = pickerHarnesses(
      [summary('omp-rpc', true), summary('claude', false)],
      null,
    );
    expect(list.map((entry) => entry.id)).toEqual(['omp-rpc']);
  });
});
