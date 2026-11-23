/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The fallback chain, one assertion per level and per field.
 *
 * These are the cases that are wrong in a way nobody notices: a card that only
 * sets a thinking level must keep its stage's harness, a stage that sets a
 * harness must not freeze a model, and a card whose stage was deleted must still
 * be startable. `origin` is asserted with every value because the sheet renders
 * it — a resolved value the panel cannot explain is an override nobody can make.
 */

import { describe, expect, test } from 'bun:test';

import type { Card } from '../protocol';
import { defaultBoard } from './board';
import { dispatchText, resolveAgent } from './resolve';

describe('agent resolution', () => {
  const board = defaultBoard('2026-01-01T00:00:00.000Z');

  function card(agent?: Card['task']['agent']): Card {
    return {
      schema: 2, id: 'k-abcdef', title: 't', status: 'in_progress', priority: 2, workspace: null,
      task: { prompt: 'p', images: [], ...(agent ? { agent } : {}) },
      sessionId: null, createdAt: '', updatedAt: '', movedAt: null,
    };
  }

  test('with nothing set anywhere, the host defaults win', () => {
    const resolved = resolveAgent(card(), board.stages[2], board);
    expect(resolved.harness).toBe('omp-rpc');
    expect(resolved.access).toBe('always-ask');
    expect(resolved.origin.harness).toBe('host');
    expect(resolved.promptDelivery).toBe('appended');
  });

  test('a stage overrides the harness and the prompt', () => {
    const stages = board.stages.map((stage) =>
      stage.id === 'in_progress'
        ? { ...stage, agent: { harness: 'claude', prompt: 'Work it.', thinking: 'high' } }
        : stage,
    );
    const resolved = resolveAgent(card(), stages[2], { ...board, stages });
    expect(resolved.harness).toBe('claude');
    expect(resolved.origin.harness).toBe('stage');
    expect(resolved.prompt).toBe('Work it.');
    // ACP has no system-prompt field, so the text rides the first turn.
    expect(resolved.promptDelivery).toBe('prepended');
  });

  test('a card overrides ONE field and inherits the rest from its stage', () => {
    const stages = board.stages.map((stage) =>
      stage.id === 'in_progress' ? { ...stage, agent: { harness: 'claude', model: { provider: 'anthropic', modelId: 'opus' } } } : stage,
    );
    const resolved = resolveAgent(card({ thinking: 'low' }), stages[2], { ...board, stages });
    expect(resolved.harness).toBe('claude');
    expect(resolved.origin.harness).toBe('stage');
    expect(resolved.thinking).toBe('low');
    expect(resolved.origin.thinking).toBe('card');
    expect(resolved.model).toEqual({ provider: 'anthropic', modelId: 'opus' });
  });

  test('a card whose stage is gone still resolves from its own settings', () => {
    const resolved = resolveAgent(card({ harness: 'codex' }), undefined, board);
    expect(resolved.harness).toBe('codex');
    expect(resolved.access).toBe('always-ask');
  });

  test('dispatchText splits the prompt by transport', () => {
    const omp = resolveAgent(card(), board.stages[2], board);
    expect(dispatchText({ ...omp, prompt: 'Rules.' }, 'Task.')).toEqual({ systemPrompt: 'Rules.', message: 'Task.' });
    const acp = dispatchText({ ...omp, prompt: 'Rules.', promptDelivery: 'prepended' }, 'Task.');
    expect(acp.systemPrompt).toBeUndefined();
    expect(acp.message).toContain('<stage_instructions>');
    expect(acp.message.endsWith('Task.')).toBe(true);
    expect(dispatchText(omp, 'Task.')).toEqual({ systemPrompt: undefined, message: 'Task.' });
  });
});
