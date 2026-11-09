import { describe, expect, test } from 'bun:test';
import {
  delegationCommand,
  delegationErrorText,
  formatDelegationPrompt,
  parseHarnessMentions,
} from '@/shared/lib/chat/composer/delegation';

describe('parseHarnessMentions', () => {
  test('a bare harness mention uses the harness default model', () => {
    const plan = parseHarnessMentions('@claude review src/auth');
    expect(plan.errors).toEqual([]);
    expect(plan.delegations).toEqual([
      { harness: 'claude', model: null, task: 'review src/auth', token: '@claude' },
    ]);
    expect(plan.orchestratorText).toBe('');
  });

  test('an explicit model rides the mention', () => {
    const plan = parseHarnessMentions('@harness:claude:opus review this');
    expect(plan.delegations[0]).toMatchObject({
      harness: 'claude',
      model: 'opus',
      task: 'review this',
    });
  });

  test('one mention per paragraph, two paragraphs are two workers', () => {
    const plan = parseHarnessMentions(
      '@harness:claude review the diff.\n\n@harness:omp fix the tests.',
    );
    expect(plan.delegations.map((entry) => entry.harness)).toEqual(['claude', 'omp-rpc']);
    expect(plan.delegations[0].task).toBe('review the diff.');
    expect(plan.delegations[1].task).toBe('fix the tests.');
  });

  test('a paragraph with no mention stays with the orchestrator', () => {
    const plan = parseHarnessMentions(
      'Coordinate this work.\n\n@claude review the diff.\n\nThen report back.',
    );
    expect(plan.delegations).toHaveLength(1);
    expect(plan.orchestratorText).toBe('Coordinate this work.\n\nThen report back.');
  });

  test('two mentions in one paragraph are refused', () => {
    const plan = parseHarnessMentions('@claude and @omp fix this', { agentNames: [] });
    expect(plan.errors[0]?.code).toBe('multiple_mentions');
    expect(delegationErrorText(plan)).toContain('blank line');
  });

  test('an unknown namespaced harness is refused', () => {
    const plan = parseHarnessMentions('@harness:nope do it');
    expect(plan.errors[0]?.code).toBe('unknown_harness');
    expect(delegationErrorText(plan)).toContain('nope');
  });

  test('a known omp agent name is not a bare harness mention', () => {
    const plan = parseHarnessMentions('@architect review this', { agentNames: ['architect'] });
    expect(plan.delegations).toEqual([]);
    expect(plan.orchestratorText).toBe('@architect review this');
  });

  test('@file: is not a harness mention', () => {
    const plan = parseHarnessMentions('look at @file:src/a.ts', { agentNames: [] });
    expect(plan.delegations).toEqual([]);
    expect(plan.orchestratorText).toBe('look at @file:src/a.ts');
  });

  test('a mention with no task is refused', () => {
    const plan = parseHarnessMentions('@claude');
    expect(plan.errors[0]?.code).toBe('empty_task');
  });
});

describe('delegation prompt', () => {
  test('the command omits --model for a default and includes it when named', () => {
    const plan = parseHarnessMentions(
      '@harness:claude review.\n\n@harness:claude:opus check.',
    );
    expect(delegationCommand(plan.delegations[0], 0)).toContain(
      '--harness claude --prompt-file -',
    );
    expect(delegationCommand(plan.delegations[1], 1)).toContain('--model opus');
  });

  test('the orchestrator prompt names the worker and the end-turn rule', () => {
    const prompt = formatDelegationPrompt(parseHarnessMentions('@claude review this'));
    expect(prompt).toContain('[kabmo orchestration contract]');
    expect(prompt).toContain('end your turn');
    expect(prompt).toContain('--harness claude');
    expect(prompt.toLowerCase()).toContain('do not poll');
  });
});
