/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Configuration section, per harness.
 *
 * The card drew the same six fields for every agent and two of them were lies.
 * Measured on this machine, from the probe the card itself reads:
 *
 * | Harness | `probe.models` | Providers |
 * |---|---|---|
 * | `omp-acp` | `kenari/agnes-2-5-flash:free`, … (221) | `kenari`, `kenari-jatis`, `aihub-brisnets-jatis` |
 * | `claude` | `default`, `opus`, `sonnet`, `haiku`, `claude-fable-5[1m]` (5) | **none** |
 * | `codex` (unauthenticated) | none | none |
 *
 * So `claude` rendered a Provider picker that could never populate, a model list
 * that never narrowed, and an Environment box hinting `GEMINI_API_KEY`. Its real
 * provider switch is `ANTHROPIC_BASE_URL`, and the form now says so.
 *
 * Pinned here: which fields a harness GETS, that a stored provider stays
 * editable when the probe has not run, and that the env example is the agent's
 * own variable names.
 */

import { describe, expect, test } from 'bun:test';

import { configFieldPlan, providerOptions } from '@/shared/lib/harness/config-fields';
import { HARNESS_IDS } from '@/shared/lib/harness/catalog';

/** The measured `omp-acp` probe, trimmed to what the plan reads. */
const OMP_PROBE = {
  models: [
    { value: 'kenari/claude-sonnet-5' },
    { value: 'kenari-jatis/claude-sonnet-5' },
    { value: 'aihub-brisnets-jatis/deepseek-v4-flash' },
  ],
  thinking: [{ value: 'off' }, { value: 'auto' }, { value: 'low' }, { value: 'high' }, { value: 'max' }],
  modes: [{ value: 'default' }, { value: 'plan' }],
};

/** The measured `claude` probe: bare model names, four built-ins and one alias. */
const CLAUDE_PROBE = {
  models: [
    { value: 'default' },
    { value: 'opus' },
    { value: 'claude-fable-5[1m]' },
    { value: 'sonnet' },
    { value: 'haiku' },
  ],
  thinking: [
    { value: 'default' }, { value: 'low' }, { value: 'medium' },
    { value: 'high' }, { value: 'xhigh' }, { value: 'max' },
  ],
  modes: [
    { value: 'default' }, { value: 'acceptEdits' }, { value: 'plan' },
    { value: 'auto' }, { value: 'bypassPermissions' },
  ],
};

describe('which fields a harness gets', () => {
  test('omp publishes selectors, so it has a Provider dimension', () => {
    const plan = configFieldPlan('omp-acp', OMP_PROBE);
    expect(plan.showProvider).toBe(true);
    expect(plan.modelsAreSelectors).toBe(true);
    expect(providerOptions(OMP_PROBE)).toEqual(['kenari', 'kenari-jatis', 'aihub-brisnets-jatis']);
    expect(plan.showThinking).toBe(true);
    expect(plan.showMode).toBe(true);
  });

  test('claude publishes BARE model names, so its Provider field is gone', () => {
    // The measured shape: no `/` anywhere in the five values.
    const plan = configFieldPlan('claude', CLAUDE_PROBE);
    expect(providerOptions(CLAUDE_PROBE)).toEqual([]);
    expect(plan.showProvider).toBe(false);
    expect(plan.modelsAreSelectors).toBe(false);
    // It DOES publish ladders, so those stay.
    expect(plan.showThinking).toBe(true);
    expect(plan.showMode).toBe(true);
  });

  test('an unprobed harness offers neither dimension', () => {
    const plan = configFieldPlan('codex', undefined);
    expect(plan.showProvider).toBe(false);
    expect(plan.showThinking).toBe(false);
    expect(plan.showMode).toBe(false);
    // The model box stays: the agent's own default is a real answer, and a
    // hand-typed id is the only way to pin one before the first probe.
    expect(plan.showModel).toBe(true);
  });

  test('a stored provider stays editable even when no probe has run', () => {
    // Hiding a value the config holds is how a form silently rewrites it.
    const plan = configFieldPlan('claude', undefined, { provider: 'anthropic-proxy' });
    expect(plan.showProvider).toBe(true);
  });
});

describe('the env box speaks the agent’s own vocabulary', () => {
  test('claude gets ANTHROPIC_*, not a Gemini example', () => {
    const plan = configFieldPlan('claude', CLAUDE_PROBE);
    expect(plan.envHint).toContain('ANTHROPIC_BASE_URL');
    expect(plan.envHint).toContain('ANTHROPIC_AUTH_TOKEN');
    expect(plan.envPlaceholder).toContain('ANTHROPIC_BASE_URL');
    expect(plan.envPlaceholder).not.toContain('GEMINI');
    // The picker's aliases need their own variables, or a gateway answers the
    // vendor's ids with 400.
    expect(plan.envHint).toContain('ANTHROPIC_DEFAULT_SONNET_MODEL');
    expect(plan.envPlaceholder).toContain('ANTHROPIC_DEFAULT_OPUS_MODEL');
    // And it says what a provider here even IS.
    expect(plan.notes.join(' ')).toContain('no provider registry');
  });

  test('antigravity gets its own two variables', () => {
    const plan = configFieldPlan('antigravity', undefined);
    expect(plan.envHint).toContain('GOOGLE_GEMINI_BASE_URL');
    expect(plan.envHint).toContain('GEMINI_API_KEY');
  });

  test('a registry harness points at its file instead of claiming an env switch', () => {
    const plan = configFieldPlan('codex', undefined);
    expect(plan.envHint).toContain('.codex/config.toml');
    expect(plan.notes.join(' ')).toContain('.codex/config.toml');
  });

  test('an agent with no registry says the launch line is the whole surface', () => {
    const plan = configFieldPlan('cursor', undefined);
    expect(plan.notes.join(' ')).toContain('launch line');
  });

  test('every harness in the catalog gets a plan without throwing', () => {
    for (const id of HARNESS_IDS) {
      const plan = configFieldPlan(id, undefined);
      expect(plan.envHint.length, id).toBeGreaterThan(0);
      expect(typeof plan.showProvider).toBe('boolean');
    }
  });
});

describe('the launch box names this harness’s own line', () => {
  test('omp’s card does not advertise Antigravity', () => {
    const plan = configFieldPlan('omp-acp', undefined, { launchCommand: 'omp acp' });
    expect(plan.launchPlaceholder).toBe('omp acp');
    expect(plan.launchHint).toContain('omp acp');
    // The quoting example carries the args and this agent's binary.
    expect(plan.launchHint).toContain('/Users/me/bin/omp acp');
    expect(plan.launchHint).not.toContain('agy');
  });

  test('Claude’s line keeps its package spec in the quoting example', () => {
    const line = 'npx -y @agentclientprotocol/claude-agent-acp@0.100.0';
    const plan = configFieldPlan('claude', undefined, { launchCommand: line });
    expect(plan.launchPlaceholder).toBe(line);
    expect(plan.launchHint).toContain(`/Users/me/bin/${line}`);
    expect(plan.launchHint).not.toContain('agy');
  });

  test('no known line means the box says so instead of inventing one', () => {
    const plan = configFieldPlan('a-user-harness', undefined);
    expect(plan.launchPlaceholder).toBe('the agent’s own command');
    expect(plan.launchHint).not.toContain('agy');
  });
});
