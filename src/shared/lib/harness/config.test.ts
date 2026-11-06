/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Per-harness config: what a user can change about ONE ACP agent.
 *
 * Four decisions are pinned here, each because the wrong one is silent:
 *
 *  - **a quoted path survives `splitCommand`** — a command override exists
 *    mostly for a binary under a directory with a space, and a naive
 *    `split(' ')` would cut it in half and fail at spawn with no explanation;
 *  - **`VALUE=` with nothing after it is kept** — an empty env var is a real
 *    setting (some CLIs read its presence), while a line without `=` is a typo
 *    and is REPORTED rather than becoming a key with an empty value;
 *  - **a stale default model falls through** — writing a model the agent no
 *    longer lists fails the first prompt, so the config resolves against what
 *    the probe actually published;
 *  - **empty means the build's default**, in every field, so an install that
 *    never opened the form spawns exactly what it spawned before.
 */

import { describe, expect, test } from 'bun:test';
import {
  EMPTY_HARNESS_CONFIG,
  harnessConfigKey,
  isHarnessConfigured,
  modelProvider,
  parseEnvLines,
  parseHarnessConfig,
  providerChoices,
  resolveDefaultModel,
  splitCommand,
} from '@/shared/lib/harness/config';

describe('splitCommand', () => {
  test('keeps a quoted path whole', () => {
    expect(splitCommand('"/Users/me/My Tools/agy" acp')).toEqual(['/Users/me/My Tools/agy', 'acp']);
    expect(splitCommand("'/Users/me/My Tools/agy' acp")).toEqual(['/Users/me/My Tools/agy', 'acp']);
  });

  test('collapses whitespace and keeps every argument', () => {
    expect(splitCommand('  cmd   acp  ')).toEqual(['cmd', 'acp']);
    expect(splitCommand('npx -y pkg@1.0.0')).toEqual(['npx', '-y', 'pkg@1.0.0']);
  });

  test('an empty line is no command at all, which is what empty means', () => {
    expect(splitCommand('')).toEqual([]);
    expect(splitCommand('   ')).toEqual([]);
  });

  test('an unterminated quote keeps the rest instead of dropping it', () => {
    // A half-typed line should fail at spawn with the agent's own error, not
    // silently lose the argument.
    expect(splitCommand('"/opt/my tool acp')).toEqual(['/opt/my tool acp']);
  });
});

describe('parseEnvLines', () => {
  test('parses KEY=VALUE, keeps an empty value, skips comments', () => {
    const { env, invalid } = parseEnvLines('A=1\n# a comment\n\nB=\nC=x=y');
    expect(env).toEqual({ A: '1', B: '', C: 'x=y' });
    expect(invalid).toEqual([]);
  });

  test('reports a line without `=` instead of inventing an empty value', () => {
    const { env, invalid } = parseEnvLines('GOOD=1\nNOT_AN_ASSIGNMENT\n=noKey');
    expect(env).toEqual({ GOOD: '1' });
    expect(invalid).toEqual(['NOT_AN_ASSIGNMENT', '=noKey']);
  });

  test('rejects a key that is not an identifier', () => {
    const { invalid } = parseEnvLines('1BAD=x\nwith-dash=x');
    expect(invalid).toHaveLength(2);
  });
});

describe('resolveDefaultModel', () => {
  const models = [
    { value: 'command-code/claude-sonnet-5' },
    { value: 'command-code/claude-opus-4-6' },
    { value: 'anthropic/claude-fable-5' },
  ];

  test('an exact model wins when the agent still lists it', () => {
    expect(resolveDefaultModel({ ...EMPTY_HARNESS_CONFIG, model: 'anthropic/claude-fable-5' }, models))
      .toBe('anthropic/claude-fable-5');
  });

  test('a stale model falls through instead of being written', () => {
    // Writing a model the agent dropped is what fails the FIRST prompt.
    expect(resolveDefaultModel({ ...EMPTY_HARNESS_CONFIG, model: 'gone/model' }, models)).toBeNull();
  });

  test('the provider picks the first of its models', () => {
    expect(resolveDefaultModel({ ...EMPTY_HARNESS_CONFIG, provider: 'anthropic' }, models))
      .toBe('anthropic/claude-fable-5');
  });

  test('a stale model still yields the provider default, not nothing', () => {
    expect(resolveDefaultModel({ ...EMPTY_HARNESS_CONFIG, model: 'gone/model', provider: 'command-code' }, models))
      .toBe('command-code/claude-sonnet-5');
  });

  test('no config is null: the agent keeps its own default', () => {
    expect(resolveDefaultModel(EMPTY_HARNESS_CONFIG, models)).toBeNull();
  });
});

describe('providerChoices', () => {
  test('lists each provider once, in publication order', () => {
    expect(providerChoices([
      { value: 'a/1' }, { value: 'b/1' }, { value: 'a/2' }, { value: 'c/1' },
    ])).toEqual(['a', 'b', 'c']);
  });

  test('a value with no slash contributes no provider', () => {
    expect(providerChoices([{ value: 'bare-model' }, { value: 'p/m' }])).toEqual(['p']);
  });

  test('modelProvider reads the FIRST slash, so nested ids keep their tail', () => {
    expect(modelProvider('command-code/deepseek/deepseek-v4-flash')).toBe('command-code');
    expect(modelProvider('bare')).toBe('');
  });
});

describe('parseHarnessConfig', () => {
  test('an absent or malformed row reads as empty, never as a partial', () => {
    expect(parseHarnessConfig(null)).toEqual(EMPTY_HARNESS_CONFIG);
    expect(parseHarnessConfig('nope')).toEqual(EMPTY_HARNESS_CONFIG);
    expect(parseHarnessConfig([])).toEqual(EMPTY_HARNESS_CONFIG);
  });

  test('a non-string field falls back on its own instead of poisoning the rest', () => {
    const parsed = parseHarnessConfig({ command: '/opt/agy acp', provider: 42, model: 'a/b' });
    expect(parsed.command).toBe('/opt/agy acp');
    expect(parsed.provider).toBe('');
    expect(parsed.model).toBe('a/b');
  });

  test('an all-empty config is "not configured", so saving it deletes the row', () => {
    expect(isHarnessConfigured(EMPTY_HARNESS_CONFIG)).toBe(false);
    expect(isHarnessConfigured({ ...EMPTY_HARNESS_CONFIG, env: 'A=1' })).toBe(true);
    // Whitespace is not configuration.
    expect(isHarnessConfigured({ ...EMPTY_HARNESS_CONFIG, command: '   ' })).toBe(false);
  });

  test('the storage key is per harness', () => {
    expect(harnessConfigKey('antigravity')).toBe('omp_harness_config:antigravity');
    expect(harnessConfigKey('antigravity')).not.toBe(harnessConfigKey('claude'));
  });
});
