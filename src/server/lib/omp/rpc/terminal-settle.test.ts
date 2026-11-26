/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a child tells its coordinator when a run ends — and, more importantly,
 * when it does not.
 *
 * Three failures are pinned here, all measured on a real orchestration run:
 *
 *  - a worker whose provider answered `400 The model … is currently
 *    unavailable` reached its coordinator as the bare sentence "The run ended
 *    with error", because the failure was read from a nested `error` field omp
 *    never writes (it uses flat `errorMessage`/`errorStatus`);
 *  - the reason was ALSO lost whenever the terminal frame was compacted, which
 *    omp does to every frame over 1 MiB by dropping what `message_end` already
 *    delivered — the failed assistant message is always among them;
 *  - a retry saga reported per attempt, so a coordinator was told its worker
 *    had failed while omp was still retrying that worker.
 *
 * The fold is driven with real frames (the shapes omp emits) and the notice is
 * read back through the shared parser, so the text a coordinator receives is
 * what is asserted — not an internal field. `settleTerminalRun` returns its
 * write, so nothing here waits on a clock.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { ensureSessionRelationsSchema } from '@/server/lib/sessions/schema.server';
import { createSessionRelation } from '@kabmo-labs/kabmo-session-relations/relations.server';
import { cancelNoticeTimer, materializeNotice } from '@/server/lib/sessions/notify.server';
import { foldSessionFrame } from '@/server/lib/omp/rpc/frame-fold';
import { makeHost } from '@/server/lib/omp/rpc/frame-fold-host.test-util';
import {
  noteRefusedPrompt,
  noteRunEndedWithoutFrame,
  settleTerminalRun,
} from '@/server/lib/omp/rpc/terminal-settle';
import {
  parseChildOutcomeNotice,
  parseOrchestrationBlock,
  type ChildOutcomeEntry,
} from '@/shared/lib/chat/orchestration/notice';
import type { AgentEvent } from '@kabmo-labs/kabmo-omp-rpc-protocol/constants';

const PARENT = 'parent-1';
const CHILD = 'child-1';
const previousAgentDir = Bun.env.PI_CODING_AGENT_DIR;

beforeEach(async () => {
  // An empty agent dir: the notice reads the child's title from its session
  // file, and a suite must never scan the developer's real ~/.omp tree.
  Bun.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), 'kabmo-settle-agent-'));
  await isolateDb();
  await ensureSessionRelationsSchema(await getDb());
  await createSessionRelation({ sessionId: CHILD, parentSessionId: PARENT });
});

afterEach(async () => {
  cancelNoticeTimer(PARENT);
  if (previousAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await releaseDb();
});

function host() {
  return makeHost({ sessionId: CHILD });
}

function fold(target: ReturnType<typeof host>, event: AgentEvent): void {
  foldSessionFrame(target, event);
}

/** The notice body, parsed the way the timeline parses it. */
async function outcomeOf(parent: string): Promise<ChildOutcomeEntry[]> {
  const text = await materializeNotice(parent);
  if (text === null) return [];
  const block = parseOrchestrationBlock(text);
  return parseChildOutcomeNotice(block?.body ?? '');
}

const FAILED_TURN = {
  type: 'message_end',
  message: {
    role: 'assistant',
    stopReason: 'error',
    errorStatus: 400,
    errorMessage: 'The model agnes-2-5-flash:free is currently unavailable.',
    content: [],
  },
} as AgentEvent;

const GOOD_TURN = {
  type: 'message_end',
  message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'all done' }] },
} as AgentEvent;

describe('a failed run reports the provider’s own words', () => {
  test('the reason survives a compacted terminal frame', async () => {
    const target = host();
    fold(target, { type: 'agent_start' });
    fold(target, FAILED_TURN);
    // omp drops the messages it already delivered: the terminal frame is empty.
    await settleTerminalRun(target, []);

    const [entry] = await outcomeOf(PARENT);
    expect(entry?.status).toBe('failed');
    expect(entry?.failure).toContain('400 The model agnes-2-5-flash:free is currently unavailable.');
  });

  test('a reason that only the terminal frame carries is still read', async () => {
    const target = host();
    fold(target, { type: 'agent_start' });
    await settleTerminalRun(target, [
      { role: 'assistant', stopReason: 'error', errorMessage: 'quota exhausted' },
    ]);

    const [entry] = await outcomeOf(PARENT);
    expect(entry?.failure).toContain('quota exhausted');
  });
});

describe('a retry saga reports once, at its end', () => {
  test('nothing is reported while omp is still retrying', () => {
    const target = host();
    fold(target, { type: 'agent_start' });
    fold(target, FAILED_TURN);
    fold(target, { type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 2_000 });
    // The attempt's own non-terminal end: the run is NOT over.
    fold(target, { type: 'agent_end', isTerminal: false, messages: [] });

    expect(target.retrySagaOpen).toBe(true);
    expect(target.runOutcomeReported).toBe(false);
  });

  test('a retry that recovers reports a completed run, not the failed attempt', async () => {
    const target = host();
    fold(target, { type: 'agent_start' });
    fold(target, FAILED_TURN);
    fold(target, { type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 1_000 });
    fold(target, { type: 'agent_start' });
    fold(target, GOOD_TURN);
    fold(target, { type: 'auto_retry_end', success: true, attempt: 1 });
    await settleTerminalRun(target, [
      { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'all done' }] },
    ]);

    const [entry] = await outcomeOf(PARENT);
    expect(entry?.status).toBe('completed');
    expect(entry?.output).toBe('all done');
    expect(entry?.failure).toBeUndefined();
  });

  test('a spent retry budget reports the budget, not a generic failure', async () => {
    const target = host();
    fold(target, { type: 'agent_start' });
    fold(target, FAILED_TURN);
    fold(target, { type: 'auto_retry_start', attempt: 3, maxAttempts: 3, delayMs: 1_000 });
    fold(target, {
      type: 'auto_retry_end',
      success: false,
      attempt: 3,
      finalError: 'Retry budget exhausted after 3 retries: 429 rate limited',
    });
    await settleTerminalRun(target, []);

    const [entry] = await outcomeOf(PARENT);
    expect(entry?.status).toBe('failed');
    expect(entry?.failure).toContain('Retry budget exhausted after 3 retries');
  });
});

describe('one outcome per run', () => {
  test('a second settle cannot rewrite a reported outcome', async () => {
    const target = host();
    fold(target, { type: 'agent_start' });
    fold(target, GOOD_TURN);
    await settleTerminalRun(target, []);
    // The process exits after the run already settled: nothing new to say.
    await noteRunEndedWithoutFrame(target, 'failed', 'the process died');

    const [entry] = await outcomeOf(PARENT);
    expect(entry?.status).toBe('completed');
  });

  test('a run that ends without a frame is reported as interrupted, once', async () => {
    const target = host();
    fold(target, { type: 'agent_start' });
    await noteRunEndedWithoutFrame(target, 'interrupted', 'the run stopped reporting progress');
    await noteRunEndedWithoutFrame(target, 'interrupted', 'the run stopped reporting progress');

    const entries = await outcomeOf(PARENT);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe('interrupted');
    expect(entries[0]?.failure).toContain('stopped reporting progress');
  });
});

describe('a refused prompt', () => {
  test('a busy refusal is not an outcome — the run is still going', async () => {
    await noteRefusedPrompt(
      { type: 'response', success: false, command: 'prompt', error: 'Agent is already processing a turn' },
      CHILD,
    );
    expect(await materializeNotice(PARENT)).toBeNull();
  });

  test('a real refusal is reported with its reason', async () => {
    await noteRefusedPrompt(
      { type: 'response', success: false, command: 'prompt', error: 'Session not found' },
      CHILD,
    );
    const [entry] = await outcomeOf(PARENT);
    expect(entry?.status).toBe('failed');
    expect(entry?.failure).toBe('Session not found');
  });
});
