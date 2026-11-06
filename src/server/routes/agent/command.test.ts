/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The spawn guard on POST /api/agent/:sessionId.
 *
 * This route is Kabmo's ONLY lazy-spawn path: a command posted for a
 * session it does not manage starts an `omp` child for it. That is right for a
 * prompt — the user asked for work — and wrong for a read. The sidebar renders
 * a subagent roster row for every session in the list, and the roster probes
 * `get_subagents` to seed itself, so an unguarded route booted a whole omp
 * process per finished session merely LOOKED at (measured: the process count
 * grew on a session whose liveness probe had just answered `running: false`).
 *
 * Both observer-only commands have RPC-free on-disk equivalents, which is what
 * a finished session is served from, so refusing them for a dead session costs
 * the client nothing.
 *
 * No module is mocked. The assertions are about which response comes back
 * BEFORE the spawn path is reached, so the real registry (empty for these ids)
 * and the real on-disk resolver are exactly the inputs that matter. The
 * "prompt" case proves the guard is not a blanket refusal: it reaches the
 * resolver and 404s for an id with no session file — a spawn was attempted.
 */

import { describe, expect, test } from 'bun:test';
import { buildAgentSnapshot, sendCommand } from '@/server/routes/agent/command';
import { registerAcpSession } from '@/server/lib/harness/register.server';
import { claimHarness } from '@/server/lib/harness/registry';
import type { HarnessSession } from '@/server/lib/harness/session';

/** Ids that no Kabmo instance manages and no session file backs. */
const DEAD = 'spawn-guard-dead-session';
const UNKNOWN = 'spawn-guard-unknown-session';

function post(sessionId: string, body: Record<string, unknown>): Promise<Response> {
  return sendCommand({
    params: { sessionId },
    request: new Request(`http://localhost/api/agent/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never) as Promise<Response>;
}

async function payload(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('agent command spawn guard', () => {
  test('refuses a roster snapshot for a session that is not running', async () => {
    const response = await post(DEAD, { type: 'get_subagents' });
    expect(response.status).toBe(409);
    expect(await payload(response)).toMatchObject({ code: 'session_not_running' });
  });

  test('refuses a transcript page for a session that is not running', async () => {
    const response = await post(DEAD, { type: 'get_subagent_messages', subagentId: 'child' });
    expect(response.status).toBe(409);
    expect(await payload(response)).toMatchObject({ code: 'session_not_running' });
  });

  // A stop names no work, only the cancelling of work under way. Falling
  // through to the spawn path resumes the session FILE — a second writer on a
  // file the process that owns the run is still appending to — and answers
  // "abort" against a child it had just created. The Stop button follows the
  // server-tracked `stream` status, so it can be pressed from a page whose
  // process does not own the run.
  test('refuses a stop for a session that is not running', async () => {
    const response = await post(DEAD, { type: 'abort' });
    expect(response.status).toBe(409);
    expect(await payload(response)).toMatchObject({ code: 'session_not_running' });
  });

  test('refuses a force-reset for a session that is not running', async () => {
    const response = await post(DEAD, { type: 'force_reset' });
    expect(response.status).toBe(409);
    expect(await payload(response)).toMatchObject({ code: 'session_not_running' });
  });

  test('does not refuse a command that asks for work', async () => {
    const response = await post(UNKNOWN, { type: 'prompt', message: 'hello' });
    // It reached the spawn path and failed there (no session file on disk),
    // which is the opposite of the guard's 409.
    expect(response.status).not.toBe(409);
  });
});

/**
 * The reattach snapshot for a NON-omp harness.
 *
 * The ACP driver reports its own run flags, and "the child is alive" is not
 * "a turn is in flight". Reporting `running: true` for an idle ACP chat re-armed
 * the generating indicator — and a reattaching tab's sidebar spinner — for a
 * turn that had already finished (measured: `isStreaming` and `isPromptRunning`
 * both false while the snapshot read `running: true`).
 */
describe('agent snapshot for a non-omp harness', () => {
  interface FakeAcp {
    running: boolean;
    dialogs: unknown[];
  }

  function registerAcp(id: string, fake: FakeAcp): () => void {
    let release: (() => void) | null = null;
    const session = {
      sessionId: id,
      harness: 'omp-acp',
      sessionFile: '',
      cwd: '/tmp',
      isStreaming: fake.running,
      isPromptRunning: fake.running,
      runModel: null,
      capabilities: {},
      configOptions: [],
      isAlive: () => true,
      isRunning: () => fake.running,
      isBusy: () => fake.running || fake.dialogs.length > 0,
      send: async () => ({
        sessionId: id,
        isStreaming: fake.running,
        isPromptRunning: fake.running,
        messageCount: 0,
      }),
      getPendingUiDialogs: () => fake.dialogs,
      resolvePendingUiDialog: () => {},
      onEvent: () => () => {},
      emit: () => {},
      destroy: () => {},
      destroyAndWait: async () => {},
      onDestroy: (callback: () => void) => {
        release = callback;
      },
    };
    registerAcpSession(session as unknown as HarnessSession, id);
    claimHarness(session as unknown as HarnessSession, 'omp-acp');
    return () => release?.();
  }

  test('an idle ACP chat is not reported as running', async () => {
    const id = 'acp-snapshot-idle';
    const release = registerAcp(id, { running: false, dialogs: [] });
    try {
      expect((await buildAgentSnapshot(id)).running).toBe(false);
    } finally {
      release();
    }
  });

  test('a streaming ACP chat is running', async () => {
    const id = 'acp-snapshot-streaming';
    const release = registerAcp(id, { running: true, dialogs: [] });
    try {
      expect((await buildAgentSnapshot(id)).running).toBe(true);
    } finally {
      release();
    }
  });

  test('a parked approval keeps an idle chat running and busy', async () => {
    const id = 'acp-snapshot-dialog';
    const dialog = { type: 'extension_ui_request', id: '7', method: 'confirm', title: 't', message: 'm', options: [] };
    const release = registerAcp(id, { running: false, dialogs: [dialog] });
    try {
      const snapshot = await buildAgentSnapshot(id);
      expect(snapshot.running).toBe(true);
      expect(snapshot.busy).toBe(true);
      expect(snapshot.pendingUiRequests).toHaveLength(1);
    } finally {
      release();
    }
  });
});

/**
 * Mode commands on a harness that has no `/kabmo-mode` extension.
 *
 * The Plan/Goal toggles send an extension command that only omp carries.
 * Forwarding it to another agent handed the MODEL the literal text — measured
 * on claude, which opened a turn with `/kabmo-mode plan on` and then refused the
 * next mode command as "already processing". The harness's own ACP `mode`
 * selector is the honest equivalent, and a scope it cannot express is refused
 * in words instead of being sent as prose.
 */
describe('mode commands on a non-omp harness', () => {
  interface Recorder {
    commands: Record<string, unknown>[];
  }

  function registerModeHarness(id: string, modes: string[], current: string): { recorder: Recorder; release: () => void } {
    const commands: Record<string, unknown>[] = [];
    let release: (() => void) | null = null;
    const session = {
      sessionId: id,
      harness: 'claude',
      sessionFile: '',
      cwd: '/tmp',
      isStreaming: false,
      isPromptRunning: false,
      runModel: null,
      capabilities: {},
      configOptions: [],
      isAlive: () => true,
      isRunning: () => false,
      isBusy: () => false,
      send: async (command: Record<string, unknown>) => {
        commands.push(command);
        if (command.type === 'get_state') {
          return {
            configOptions: [
              {
                id: 'mode',
                name: 'Mode',
                category: 'mode',
                type: 'select',
                currentValue: current,
                options: modes.map((value) => ({ value, name: value })),
              },
            ],
          };
        }
        return { ok: true };
      },
      getPendingUiDialogs: () => [],
      resolvePendingUiDialog: () => {},
      onEvent: () => () => {},
      emit: () => {},
      destroy: () => {},
      destroyAndWait: async () => {},
      onDestroy: (callback: () => void) => {
        release = callback;
      },
    };
    registerAcpSession(session as unknown as HarnessSession, id);
    claimHarness(session as unknown as HarnessSession, 'claude');
    return { recorder: { commands }, release: () => release?.() };
  }

  function postMode(id: string, body: Record<string, unknown>): Promise<Response> {
    return sendCommand({
      params: { sessionId: id },
      request: new Request(`http://localhost/api/agent/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-kabmo-peer-hop': '1' },
        body: JSON.stringify(body),
      }),
    } as never) as Promise<Response>;
  }

  test('plan on drives the harness mode selector, never a prompt', async () => {
    const { recorder, release } = registerModeHarness('mode-plan-on', ['default', 'plan', 'acceptEdits'], 'default');
    try {
      const response = await postMode('mode-plan-on', { type: 'kabmo_mode', scope: 'plan', action: 'on' });
      expect(response.status).toBe(200);
      expect(recorder.commands.some((command) => command.type === 'prompt')).toBe(false);
      expect(recorder.commands.some((command) => command.type === 'set_mode' && command.mode === 'plan')).toBe(true);
    } finally {
      release();
    }
  });

  test('plan off returns to `default`', async () => {
    const { recorder, release } = registerModeHarness('mode-plan-off', ['default', 'plan'], 'plan');
    try {
      expect((await postMode('mode-plan-off', { type: 'kabmo_mode', scope: 'plan', action: 'off' })).status).toBe(200);
      expect(recorder.commands.some((command) => command.type === 'set_mode' && command.mode === 'default')).toBe(true);
    } finally {
      release();
    }
  });

  test('plan state answers from the selector without touching it', async () => {
    const { recorder, release } = registerModeHarness('mode-plan-state', ['default', 'plan'], 'plan');
    try {
      const response = await postMode('mode-plan-state', { type: 'kabmo_mode', scope: 'plan', action: 'state' });
      expect(await response.json()).toMatchObject({ success: true, data: { enabled: true } });
      expect(recorder.commands.some((command) => command.type === 'set_mode')).toBe(false);
    } finally {
      release();
    }
  });

  test('a harness with no plan value refuses in words, and sends no prompt', async () => {
    const { recorder, release } = registerModeHarness('mode-no-plan', ['worker', 'plan-builder'], 'worker');
    try {
      const response = await postMode('mode-no-plan', { type: 'kabmo_mode', scope: 'plan', action: 'on' });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string; code: string };
      expect(body.error).toContain('has no plan mode');
      expect(body.code).toBe('mode_not_supported');
      expect(recorder.commands.some((command) => command.type === 'prompt')).toBe(false);
    } finally {
      release();
    }
  });

  test('goal is refused rather than sent to the model', async () => {
    const { recorder, release } = registerModeHarness('mode-goal', ['default', 'plan'], 'default');
    try {
      const response = await postMode('mode-goal', {
        type: 'kabmo_mode',
        scope: 'goal',
        action: 'create',
        payload: { objective: 'ship it' },
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain('has no goal mode');
      expect(recorder.commands.some((command) => command.type === 'prompt')).toBe(false);
    } finally {
      release();
    }
  });
});
