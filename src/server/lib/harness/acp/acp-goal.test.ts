/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Goal mode on an ACP transport.
 *
 * Kabmo owns the record because the agent has no `/kabmo-mode` extension; the
 * driver audits the closed turn and opens the next one itself. These cases pin
 * the state machine the composer reads: create/pause/resume/drop, the turn
 * ceiling, and the terminal verdicts.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import {
  applyAcpGoalAction,
  finishAcpGoal,
  type AcpGoalHost,
} from '@/server/lib/harness/acp/acp-goal.server';
import { loadAcpGoalState, loadAcpGoalState as load } from '@/server/lib/harness/acp/acp-goal-state.server';
import { driveAcpGoalAfterTurn } from '@/server/lib/harness/acp/acp-goal-driver.server';
import type { GoalAuditAnswers } from '@/server/lib/omp/session/goal-auditor.server';

interface TestHost extends AcpGoalHost {
  sent: string[];
  events: { type: string; [key: string]: unknown }[];
  busy: boolean;
  usageTokens: number;
}

function makeHost(id = 'acp-goal-test'): TestHost {
  const host: TestHost = {
    sessionId: id,
    harness: 'claude',
    cwd: '/tmp',
    runModel: null,
    busy: false,
    usageTokens: 0,
    sent: [],
    events: [],
    isAlive: () => true,
    isBusy: () => host.busy,
    send: async (command) => {
      host.sent.push(String(command.message ?? ''));
      return {};
    },
    emit: (event) => {
      host.events.push(event);
    },
  };
  return host;
}

const ASSISTANT_DONE = {
  role: 'assistant',
  content: [{ type: 'text', text: 'All done: the importer is implemented and tested.' }],
};

const audit = (answers: GoalAuditAnswers) => async () => answers;
const settings = async () => ({ auditEnabled: true, auditModel: '' });

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

describe('ACP goal actions', () => {
  test('create stores an active record without opening a turn when armed', async () => {
    const host = makeHost();
    const result = await applyAcpGoalAction(host, {
      scope: 'goal',
      action: 'create',
      payload: { objective: 'ship the importer', startTurn: false },
    });
    expect(result.ok).toBe(true);
    const state = await load(host.sessionId);
    expect(state.record).toMatchObject({ objective: 'ship the importer', status: 'active' });
    expect(host.sent).toEqual([]);
    expect(host.events.some((event) => String(event.message).startsWith('KABMO_GOAL_STATE:'))).toBe(true);
  });

  test('create with a start turn sends the objective', async () => {
    const host = makeHost();
    await applyAcpGoalAction(host, {
      scope: 'goal',
      action: 'create',
      payload: { objective: 'fix the build' },
    });
    expect(host.sent).toHaveLength(1);
    expect(host.sent[0]).toContain('fix the build');
  });

  test('pause and resume move the record, and resume starts the loop', async () => {
    const host = makeHost();
    await applyAcpGoalAction(host, { scope: 'goal', action: 'create', payload: { objective: 'x', startTurn: false } });
    await applyAcpGoalAction(host, { scope: 'goal', action: 'pause' });
    expect((await load(host.sessionId)).record?.status).toBe('paused');

    host.busy = true; // the scheduled continuation defer to the next turn end
    await applyAcpGoalAction(host, { scope: 'goal', action: 'resume' });
    const state = await load(host.sessionId);
    expect(state.record?.status).toBe('active');
    expect(state.turns).toBe(0);
  });

  test('drop closes the goal', async () => {
    const host = makeHost();
    await applyAcpGoalAction(host, { scope: 'goal', action: 'create', payload: { objective: 'x', startTurn: false } });
    await applyAcpGoalAction(host, { scope: 'goal', action: 'drop' });
    expect((await load(host.sessionId)).record?.status).toBe('dropped');
  });

  test('a completed goal is terminal, and every other stop stays resumable', async () => {
    const host = makeHost();
    await applyAcpGoalAction(host, { scope: 'goal', action: 'create', payload: { objective: 'x', startTurn: false } });
    await finishAcpGoal(host, 'complete');
    let state = await loadAcpGoalState(host.sessionId);
    expect(state.record?.status).toBe('complete');
    expect(state.continuation?.stopped).toBe('complete');

    const second = makeHost('acp-goal-blocked');
    await applyAcpGoalAction(second, { scope: 'goal', action: 'create', payload: { objective: 'y', startTurn: false } });
    await finishAcpGoal(second, 'blocked');
    state = await loadAcpGoalState(second.sessionId);
    expect(state.record?.status).toBe('paused');
    expect(state.continuation?.stopped).toBe('blocked');
  });

  test('state answers without touching the agent', async () => {
    const host = makeHost();
    await applyAcpGoalAction(host, { scope: 'goal', action: 'create', payload: { objective: 'x', startTurn: false } });
    const result = await applyAcpGoalAction(host, { scope: 'goal', action: 'state' });
    expect(result).toMatchObject({ ok: true, data: { enabled: true } });
  });
});

describe('ACP goal driver', () => {
  test('an audit that reports completion closes the goal and sends nothing', async () => {
    const host = makeHost();
    await applyAcpGoalAction(host, { scope: 'goal', action: 'create', payload: { objective: 'ship', startTurn: false } });
    await driveAcpGoalAfterTurn(host, ASSISTANT_DONE, {
      deps: { audit: audit({ allDone: true, remaining: false, needsUser: false }), settings },
    });
    const state = await load(host.sessionId);
    expect(state.record?.status).toBe('complete');
    expect(host.sent).toEqual([]);
  });

  test('an audit that says keep going opens the next turn and counts it', async () => {
    const host = makeHost();
    await applyAcpGoalAction(host, { scope: 'goal', action: 'create', payload: { objective: 'ship', startTurn: false } });
    await driveAcpGoalAfterTurn(host, ASSISTANT_DONE, {
      deps: { audit: audit({ allDone: false, remaining: true, needsUser: false }), settings },
    });
    const state = await load(host.sessionId);
    expect(state.turns).toBe(1);
    expect(state.continuation).toMatchObject({ turn: 1, maxTurns: 25 });
    expect(host.sent[0]).toContain('Continue working toward the active goal');
  });

  test('the goal ceiling closes the loop instead of driving forever', async () => {
    const host = makeHost();
    await applyAcpGoalAction(host, {
      scope: 'goal',
      action: 'create',
      payload: { objective: 'ship', maxTurns: 1, startTurn: false },
    });
    const continueAudit = audit({ allDone: false, remaining: true, needsUser: false });
    await driveAcpGoalAfterTurn(host, ASSISTANT_DONE, { deps: { audit: continueAudit, settings } });
    let state = await load(host.sessionId);
    // The first decision opens turn 1; the ceiling is read before the NEXT one.
    expect(state.turns).toBe(1);
    expect(host.sent).toHaveLength(1);

    await driveAcpGoalAfterTurn(host, ASSISTANT_DONE, { deps: { audit: continueAudit, settings } });
    state = await load(host.sessionId);
    expect(state.record?.status).toBe('paused');
    expect(state.continuation).toMatchObject({ turn: 1, maxTurns: 1, stopped: 'max-turns' });
    expect(host.sent).toHaveLength(1);
  });

  test('a cancelled turn is never audited', async () => {
    const host = makeHost();
    await applyAcpGoalAction(host, { scope: 'goal', action: 'create', payload: { objective: 'x', startTurn: false } });
    let audited = false;
    await driveAcpGoalAfterTurn(host, ASSISTANT_DONE, {
      cancelled: true,
      deps: {
        audit: async () => {
          audited = true;
          return { allDone: false, remaining: true, needsUser: false };
        },
        settings,
      },
    });
    expect(audited).toBe(false);
    expect(host.sent).toEqual([]);
  });

  test('a measured budget stops the loop before the next audit', async () => {
    const host = makeHost();
    await applyAcpGoalAction(host, {
      scope: 'goal',
      action: 'create',
      payload: { objective: 'x', tokenBudget: 100, startTurn: false },
    });
    host.usageTokens = 180;
    let audited = false;
    await driveAcpGoalAfterTurn(host, ASSISTANT_DONE, {
      deps: {
        audit: async () => {
          audited = true;
          return { allDone: false, remaining: true, needsUser: false };
        },
        settings,
      },
    });
    const state = await load(host.sessionId);
    expect(audited).toBe(false);
    expect(state.record?.status).toBe('budget-limited');
    expect(state.record?.tokensUsed).toBe(180);
    expect(host.sent).toEqual([]);
  });
});
