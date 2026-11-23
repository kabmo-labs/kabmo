/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The board's pure view logic, and the request a card dispatches.
 *
 * These are the rules a reader would otherwise have to infer from a render: which
 * stage a hidden lane keeps, which lens a fresh board opens on, and exactly what
 * a Start-work request carries. Each one is a silent bug when wrong — a hidden
 * lane that loses cards, a lens that hides the board, a spawn with the stage
 * prompt in the wrong place.
 */

import { describe, expect, test } from 'bun:test';

import type { Card, CardSummary, ResolvedAgent, Stage } from '../protocol';
import { defaultBoard } from '../store/board';
import { resolveAgent } from '../store/resolve';
import { followUpBody, modelCommands, startWorkBody, startWork } from './start-work';
import { defaultLens, lensCards, lensCounts } from './use-board';
import { visibleStages, unplacedCards } from './index';
import { originLabel, isOverridden } from './CardSheet';
import { priorityLabel, promptPreview, workspaceLabel } from './CardTile';

function summary(overrides: Partial<CardSummary> = {}): CardSummary {
  return {
    schema: 2,
    id: 'k-aaaaaa',
    title: 'A card',
    status: 'open',
    priority: 2,
    workspace: '/w/alpha',
    sessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    movedAt: null,
    hasPrompt: true,
    imageCount: 0,
    ...overrides,
  };
}

function card(overrides: Partial<Card> = {}): Card {
  return {
    schema: 2,
    id: 'k-aaaaaa',
    title: 'A card',
    status: 'in_progress',
    priority: 1,
    workspace: '/w/alpha',
    task: { prompt: 'Fix the portal.', images: [] },
    sessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    movedAt: null,
    ...overrides,
  };
}

describe('lenses', () => {
  const cards = [summary(), summary({ id: 'k-bbbbbb', workspace: '/w/beta' }), summary({ id: 'k-cccccc', workspace: null })];

  test('a workspace is open → that lens; none → everything', () => {
    expect(defaultLens('/w/alpha')).toBe('workspace');
    expect(defaultLens(null)).toBe('all');
  });

  test('a lens filters and never moves', () => {
    expect(lensCards(cards, 'all', '/w/alpha')).toHaveLength(3);
    expect(lensCards(cards, 'workspace', '/w/alpha').map((entry) => entry.id)).toEqual(['k-aaaaaa']);
    expect(lensCards(cards, 'unfiled', '/w/alpha').map((entry) => entry.id)).toEqual(['k-cccccc']);
    // No workspace open means the workspace lens is empty, not "everything".
    expect(lensCards(cards, 'workspace', null)).toEqual([]);
  });

  test('the counts let a chip say what is elsewhere', () => {
    expect(lensCounts(cards, '/w/alpha')).toEqual({ all: 3, workspace: 1, unfiled: 1 });
    expect(lensCounts(cards, null)).toEqual({ all: 3, workspace: 0, unfiled: 1 });
  });
});

describe('stages drawn', () => {
  const stages: Stage[] = defaultBoard('2026-01-01T00:00:00.000Z').stages;

  test('a hidden stage with cards still renders', () => {
    // Hiding quiets a lane; it must never make a card disappear.
    const withReview = [...stages];
    const drawn = visibleStages(withReview, [summary({ status: 'review' })]);
    expect(drawn.map((stage) => stage.id)).toContain('review');
  });

  test('a hidden empty stage does not', () => {
    expect(visibleStages(stages, [summary()]).map((stage) => stage.id)).not.toContain('review');
  });

  test('a card whose status matches no stage is Unplaced, not dropped', () => {
    const orphans = unplacedCards(stages, [summary({ status: 'doing' })]);
    expect(orphans.map((entry) => entry.status)).toEqual(['doing']);
  });
});

describe('card face', () => {
  test('priority clamps into P0..P4', () => {
    expect(priorityLabel(0)).toBe('P0');
    expect(priorityLabel(9)).toBe('P4');
    expect(priorityLabel(-1)).toBe('P0');
  });

  test('the prompt preview says whether there is one, and how many images', () => {
    expect(promptPreview(summary({ hasPrompt: false }))).toBe('no prompt');
    expect(promptPreview(summary({ hasPrompt: true }))).toBe('prompt');
    expect(promptPreview(summary({ hasPrompt: true, imageCount: 2 }))).toBe('prompt · 2 images');
  });

  test('a workspace reads as its last segment, and null reads as unfiled', () => {
    expect(workspaceLabel('/Users/x/projects/kabmo')).toBe('kabmo');
    expect(workspaceLabel('C:\\work\\alpha')).toBe('alpha');
    expect(workspaceLabel(null)).toBe('unfiled');
  });
});

describe('origin labels', () => {
  const stage: Stage = { id: 'in_progress', label: 'In Progress', hidden: false, session: true };

  test('each level names itself, so an override is visible before it is made', () => {
    expect(originLabel('card', stage)).toBe('this card');
    expect(originLabel('stage', stage)).toBe('stage: In Progress');
    expect(originLabel('defaults', stage)).toBe('board default');
    expect(originLabel('host', stage)).toBe('host default');
  });

  test('only a card-level value is an override', () => {
    expect(isOverridden('card')).toBe(true);
    expect(isOverridden('stage')).toBe(false);
  });
});

describe('start work', () => {
  const board = defaultBoard('2026-01-01T00:00:00.000Z');
  const stage = board.stages.find((entry) => entry.id === 'in_progress');

  test('omp gets the stage prompt as a system prompt and the task as the message', () => {
    const resolved: ResolvedAgent = { ...resolveAgent(card(), stage, board), prompt: 'Work it.' };
    const body = startWorkBody(card(), resolved);
    expect(body.harness).toBe('omp-rpc');
    expect(body.systemPrompt).toBe('Work it.');
    expect(body.message).toBe('Fix the portal.');
    expect(body.cwd).toBe('/w/alpha');
    expect(body.accessMode).toBe('always-ask');
  });

  test('ACP gets both in the message, because session/new has no field for one', () => {
    // The delivery is derived from the HARNESS, so the stage has to be the one
    // that names an ACP agent — spreading `harness` alone would keep omp's
    // `appended` delivery and quietly test the wrong branch.
    const acpStage: Stage = { ...stage!, agent: { harness: 'claude', prompt: 'Review it.' } };
    const resolved = resolveAgent(card(), acpStage, board);
    expect(resolved.promptDelivery).toBe('prepended');
    const body = startWorkBody(card(), resolved);
    expect(body.systemPrompt).toBeUndefined();
    expect(body.message).toContain('<stage_instructions>');
    expect(body.message).toContain('Review it.');
    expect(body.message.endsWith('Fix the portal.')).toBe(true);
  });

  test('a card with no workspace is refused before any request is built', () => {
    expect(() => startWorkBody(card({ workspace: null }), resolveAgent(card(), stage, board))).toThrow(/workspace/i);
  });

  test('a refusal from the route is surfaced verbatim', async () => {
    const resolved = resolveAgent(card(), stage, board);
    const refused = await startWork(card(), resolved, async () => ({ error: 'Mock mode runs no agent process', code: 'mock_mode' }));
    expect(refused).toEqual({ ok: false, error: 'Mock mode runs no agent process' });
  });

  test('an empty prompt never reaches the route', async () => {
    const resolved = resolveAgent(card(), stage, board);
    let called = false;
    const refused = await startWork(card({ task: { prompt: '   ', images: [] } }), resolved, async () => {
      called = true;
      return { success: true, sessionId: 'x' };
    });
    expect(called).toBe(false);
    expect(refused.ok).toBe(false);
  });

  test('the answered session id is what links the card', async () => {
    const resolved = resolveAgent(card(), stage, board);
    const started = await startWork(card(), resolved, async () => ({ success: true, sessionId: 'sess-42' }));
    expect(started).toEqual({ ok: true, sessionId: 'sess-42' });
  });

  test('images ride the request in the shape the route takes', () => {
    const resolved = resolveAgent(card(), stage, board);
    const withImage = card({ task: { prompt: 'Look.', images: [{ name: 'a.png', mimeType: 'image/png', dataBase64: 'AAAA' }] } });
    expect(startWorkBody(withImage, resolved).images).toEqual([{ data: 'AAAA', mimeType: 'image/png' }]);
  });

  test('a follow-up always prepends, because a live session cannot take a flag', () => {
    const resolved: ResolvedAgent = { ...resolveAgent(card(), stage, board), prompt: 'Rules.' };
    const body = followUpBody(card(), resolved) as { message: string };
    expect(body.message).toContain('<stage_instructions>');
  });

  test('the model commands are separate verbs, model first', () => {
    const resolved: ResolvedAgent = {
      ...resolveAgent(card(), stage, board),
      model: { provider: 'p', modelId: 'm' },
      thinking: 'high',
    };
    expect(modelCommands(resolved)).toEqual([
      { type: 'set_model', provider: 'p', modelId: 'm' },
      { type: 'set_thinking_level', level: 'high' },
    ]);
    expect(modelCommands({ ...resolved, model: null, thinking: null })).toEqual([]);
  });
});
