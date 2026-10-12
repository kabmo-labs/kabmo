/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The small, self-contained pieces of the omp RPC layer that every route and
 * session wrapper composes. Each owns one rule whose regression is silent:
 *
 *  - `rpcErrorResponse` maps the three error classes onto the HTTP envelope;
 *    a wrong branch turns a specific `code` into the generic fallback.
 *  - `EventFanout` must keep one throwing subscriber from starving the rest,
 *    because it sits directly on the frame path.
 *  - `PendingUiDialogs` remembers the ids omp is blocked on, and reports
 *    whether the set CHANGED so a caller does not republish on a `notify`.
 *  - `sanitizeProjectCommandEnvironment` strips the chamber host's own PORT /
 *    NODE_ENV / password from a spawned project command.
 *  - `recordSpawnProvenance` / `reconcileSpawnApprovalMode` decide whether a
 *    live session must be respawned for a new `--approval-mode`.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { rpcErrorResponse } from '@/server/lib/omp/rpc/errors';
import { EventFanout } from '@/server/lib/omp/rpc/event-fanout';
import { PendingUiDialogs } from '@/server/lib/omp/rpc/pending-ui-dialogs';
import { WebRpcError, type AgentEvent } from '@/server/lib/omp/rpc/constants';
import {
  RpcCommandError,
  RpcCommandTimeoutError,
  STDERR_TAIL_LIMIT,
  sanitizeProjectCommandEnvironment,
} from '@/server/lib/omp/rpc/process-helpers';
import {
  getSpawnApprovalMode,
  getSpawnModeEnv,
  reconcileSpawnApprovalMode,
  recordSpawnProvenance,
} from '@/server/lib/omp/rpc/spawn-provenance';
import type { AgentSessionWrapper } from '@/server/lib/omp/rpc/manager';

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('rpcErrorResponse', () => {
  test('maps WebRpcError to 400 with its own code', async () => {
    const response = rpcErrorResponse(new WebRpcError('denied', 'forbidden_action'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'denied', code: 'forbidden_action' });
  });

  test('maps a timeout to rpc_command_timeout regardless of the command', async () => {
    const response = rpcErrorResponse(new RpcCommandTimeoutError('get_state', 5_000));
    expect(await response.json()).toEqual({
      error: 'RPC command get_state timed out after 5000ms',
      code: 'rpc_command_timeout',
    });
  });

  test('keeps a command error code when it has one', async () => {
    const response = rpcErrorResponse(new RpcCommandError('set_model', 'unknown model', 'model_not_found'));
    expect(await response.json()).toEqual({ error: 'unknown model', code: 'model_not_found' });
  });

  test('falls back to rpc_command_failed when a command error has no code', async () => {
    const response = rpcErrorResponse(new RpcCommandError('prompt', 'boom'));
    expect(await response.json()).toEqual({ error: 'boom', code: 'rpc_command_failed' });
  });

  test('passes a plain Error message through without a code', async () => {
    expect(await rpcErrorResponse(new Error('plain failure')).json()).toEqual({ error: 'plain failure' });
  });

  test('stringifies a non-Error rejection value', async () => {
    expect(await rpcErrorResponse('string failure').json()).toEqual({ error: 'string failure' });
  });
});

describe('EventFanout', () => {
  const event = (n: number): AgentEvent => ({ type: 'message_update', n });

  test('delivers to every listener in insertion order', () => {
    const fanout = new EventFanout();
    const seen: string[] = [];
    fanout.on(() => seen.push('first'));
    fanout.on(() => seen.push('second'));
    fanout.emit(event(1));
    expect(seen).toEqual(['first', 'second']);
  });

  test('a throwing listener does not starve the ones after it', () => {
    const fanout = new EventFanout();
    const seen: number[] = [];
    fanout.on(() => {
      throw new Error('sse encode failed');
    });
    fanout.on((e) => seen.push(e.n as number));
    expect(() => fanout.emit(event(7))).not.toThrow();
    expect(seen).toEqual([7]);
  });

  test('an unsubscribed listener no longer fires', () => {
    const fanout = new EventFanout();
    const seen: number[] = [];
    const off = fanout.on((e) => seen.push(e.n as number));
    fanout.emit(event(1));
    off();
    fanout.emit(event(2));
    expect(seen).toEqual([1]);
  });

  test('a listener registered twice receives twice and each removal takes one out', () => {
    const fanout = new EventFanout();
    let calls = 0;
    const listener = () => calls++;
    const offFirst = fanout.on(listener);
    fanout.on(listener);
    fanout.emit(event(1));
    expect(calls).toBe(2);
    offFirst();
    fanout.emit(event(2));
    expect(calls).toBe(3);
  });

  test('a listener added after an emit sees no replay of earlier events', () => {
    const fanout = new EventFanout();
    fanout.emit(event(1));
    const seen: number[] = [];
    fanout.on((e) => seen.push(e.n as number));
    fanout.emit(event(2));
    expect(seen).toEqual([2]);
  });
});

describe('PendingUiDialogs', () => {
  test('tracks an answerable request and reports the change', () => {
    const dialogs = new PendingUiDialogs();
    expect(dialogs.track({ type: 'extension_ui_request', id: 'a', method: 'select' })).toBe(true);
    expect(dialogs.list()).toEqual([{ type: 'extension_ui_request', id: 'a', method: 'select' }]);
  });

  test('ignores fire-and-forget methods and requests without an id', () => {
    const dialogs = new PendingUiDialogs();
    expect(dialogs.track({ type: 'extension_ui_request', id: 'n', method: 'notify' })).toBe(false);
    expect(dialogs.track({ type: 'extension_ui_request', method: 'confirm' })).toBe(false);
    expect(dialogs.list()).toEqual([]);
  });

  test('a repeat of the same id is not a change', () => {
    const dialogs = new PendingUiDialogs();
    dialogs.track({ type: 'extension_ui_request', id: 'a', method: 'input' });
    expect(dialogs.track({ type: 'extension_ui_request', id: 'a', method: 'input' })).toBe(false);
    expect(dialogs.list()).toHaveLength(1);
  });

  test('keeps insertion order, oldest first', () => {
    const dialogs = new PendingUiDialogs();
    dialogs.track({ type: 'extension_ui_request', id: 'first', method: 'select' });
    dialogs.track({ type: 'extension_ui_request', id: 'second', method: 'confirm' });
    expect(dialogs.list().map((f) => f.id)).toEqual(['first', 'second']);
  });

  test('a cancel with a target id withdraws that request once', () => {
    const dialogs = new PendingUiDialogs();
    dialogs.track({ type: 'extension_ui_request', id: 'a', method: 'editor' });
    expect(dialogs.track({ type: 'extension_ui_request', method: 'cancel', targetId: 'a' })).toBe(true);
    expect(dialogs.track({ type: 'extension_ui_request', method: 'cancel', targetId: 'a' })).toBe(false);
    expect(dialogs.list()).toEqual([]);
  });

  test('a cancel without a target id changes nothing', () => {
    const dialogs = new PendingUiDialogs();
    expect(dialogs.track({ type: 'extension_ui_request', method: 'cancel' })).toBe(false);
  });

  test('resolve forgets a request exactly once', () => {
    const dialogs = new PendingUiDialogs();
    dialogs.track({ type: 'extension_ui_request', id: 'a', method: 'select' });
    expect(dialogs.resolve('a')).toBe(true);
    expect(dialogs.resolve('a')).toBe(false);
  });

  test('clear drops every pending dialog', () => {
    const dialogs = new PendingUiDialogs();
    dialogs.track({ type: 'extension_ui_request', id: 'a', method: 'select' });
    dialogs.clear();
    expect(dialogs.list()).toEqual([]);
  });
});

describe('sanitizeProjectCommandEnvironment', () => {
  const base = { PATH: '/bin', PORT: '3000', NODE_ENV: 'production', OMPCHAMBER_UI_PASSWORD: 'secret', NEXT_PUBLIC_X: '1', KEEP: 'yes' };

  test('removes the chamber host variables and keeps everything else', () => {
    expect(sanitizeProjectCommandEnvironment(base, 'linux')).toEqual({ PATH: '/bin', KEEP: 'yes' });
  });

  test('does not mutate the base environment', () => {
    sanitizeProjectCommandEnvironment(base, 'linux');
    expect(base.PORT).toBe('3000');
  });

  test('matches names case-insensitively only on win32', () => {
    const mixed = { port: '1', Node_Env: 'x', next_private: '1', keep: 'ok' };
    expect(sanitizeProjectCommandEnvironment(mixed, 'win32')).toEqual({ keep: 'ok' });
    expect(sanitizeProjectCommandEnvironment(mixed, 'linux')).toEqual(mixed);
  });
});

describe('process-helpers error classes', () => {
  test('RpcCommandError carries command and optional code', () => {
    const error = new RpcCommandError('set_model', 'bad', 'bad_model');
    expect(error.name).toBe('RpcCommandError');
    expect(error.command).toBe('set_model');
    expect(error.code).toBe('bad_model');
    expect(error.message).toBe('bad');
  });

  test('RpcCommandTimeoutError builds its own message and keeps the timeout', () => {
    const error = new RpcCommandTimeoutError('prompt', 30_000);
    expect(error.name).toBe('RpcCommandTimeoutError');
    expect(error.command).toBe('prompt');
    expect(error.timeoutMs).toBe(30_000);
    expect(error.message).toBe('RPC command prompt timed out after 30000ms');
  });

  test('RpcCommandTimeoutError accepts an explicit message', () => {
    expect(new RpcCommandTimeoutError('x', 1, 'custom').message).toBe('custom');
  });

  test('the stderr tail is bounded at 8 KiB', () => {
    expect(STDERR_TAIL_LIMIT).toBe(8 * 1024);
  });
});

describe('spawn provenance', () => {
  function fakeSession(overrides: Partial<{ busy: boolean; sessionFile: string; destroyed: boolean }> = {}) {
    const state = { busy: overrides.busy ?? false, destroyed: false };
    const session = {
      sessionFile: overrides.sessionFile ?? '',
      isBusy: () => state.busy,
      destroyAndWait: async () => {
        state.destroyed = true;
      },
    } as unknown as AgentSessionWrapper;
    return { session, state };
  }

  test('defaults to always-ask and an empty mode env for an unrecorded session', () => {
    const { session } = fakeSession();
    expect(getSpawnApprovalMode(session)).toBe('always-ask');
    expect(getSpawnModeEnv(session)).toEqual({});
  });

  test('records the approval mode and mode env for a session', () => {
    const { session } = fakeSession();
    recordSpawnProvenance(session, 'yolo', { CHAMBER_MODES: 'plan' });
    expect(getSpawnApprovalMode(session)).toBe('yolo');
    expect(getSpawnModeEnv(session)).toEqual({ CHAMBER_MODES: 'plan' });
  });

  test('undefined provenance falls back to the defaults', () => {
    const { session } = fakeSession();
    recordSpawnProvenance(session, undefined, undefined);
    expect(getSpawnApprovalMode(session)).toBe('always-ask');
    expect(getSpawnModeEnv(session)).toEqual({});
  });

  test('reconcile is a no-op when the spawned mode already matches', async () => {
    const { session, state } = fakeSession();
    recordSpawnProvenance(session, 'write', undefined);
    expect(await reconcileSpawnApprovalMode(session, 'write')).toBe(false);
    expect(state.destroyed).toBe(false);
  });

  test('reconcile never kills a busy session', async () => {
    const { session, state } = fakeSession({ busy: true, sessionFile: '/tmp/whatever.jsonl' });
    recordSpawnProvenance(session, 'write', undefined);
    expect(await reconcileSpawnApprovalMode(session, 'yolo')).toBe(false);
    expect(state.destroyed).toBe(false);
  });

  test('reconcile refuses a session with no on-disk file yet', async () => {
    const { session, state } = fakeSession();
    recordSpawnProvenance(session, 'write', undefined);
    expect(await reconcileSpawnApprovalMode(session, 'yolo')).toBe(false);
    expect(state.destroyed).toBe(false);
  });

  test('reconcile refuses a session whose file was deleted', async () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'omp-prov-'));
    tempDirs.push(dir);
    const { session, state } = fakeSession({ sessionFile: join(dir, 'gone.jsonl') });
    recordSpawnProvenance(session, 'write', undefined);
    expect(await reconcileSpawnApprovalMode(session, 'yolo')).toBe(false);
    expect(state.destroyed).toBe(false);
  });

  test('reconcile destroys an idle session whose file exists so the caller can respawn', async () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'omp-prov-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'live.jsonl');
    fs.writeFileSync(sessionFile, '{"type":"session"}\n');
    const { session, state } = fakeSession({ sessionFile });
    recordSpawnProvenance(session, 'write', undefined);
    expect(await reconcileSpawnApprovalMode(session, 'yolo')).toBe(true);
    expect(state.destroyed).toBe(true);
  });
});

describe('PendingUiDialogs with a grouped ask', () => {
  test('tracks method:ask — the frame omp parks on after set_ask_dialog', () => {
    const dialogs = new PendingUiDialogs();
    const ask = {
      type: 'extension_ui_request',
      id: 'ask-1',
      method: 'ask',
      questions: [{ id: 'q1', question: 'Pick', options: [{ label: 'a' }] }],
    };
    expect(dialogs.track(ask)).toBe(true);
    expect(dialogs.list()).toEqual([ask]);
    // Still the ONLY reattach source: answering it forgets it.
    expect(dialogs.resolve('ask-1')).toBe(true);
    expect(dialogs.list()).toEqual([]);
  });
});
