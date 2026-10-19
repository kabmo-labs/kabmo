/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Steering and the commands a pending ask/approval dialog parks.
 *
 * Both halves are about an ack that omp may never send. A steer is QUEUED
 * before omp parks on a dialog, so a late ack must not destroy the child; an
 * `abort`/`abort_and_prompt` is not queued at all, so waiting on it hangs the
 * HTTP request and is refused up front instead. Measured against omp 18.7.0:
 * with a `select` dialog pending, both verbs sat unacknowledged past 15 s and
 * the steer ran the moment the dialog was answered.
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The session command dispatcher: how a client command becomes an RPC command.
 *
 * Every case here is a place where a wrong mapping is a user-visible lie — a
 * prompt that reaches the model as literal text (`/hotkeys`), an abort that
 * arrives as something else, an image payload that bypasses the size bound. The
 * timeout policy is included because it decides whether a wedged child is
 * destroyed or a live turn is thrown away with its subagents. The host and the
 * process are fakes; no omp child is spawned.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dispatchSessionCommand } from '@/server/lib/omp/rpc/session-commands';
import { RpcCommandTimeoutError } from '@/server/lib/omp/rpc/process';
import { WebRpcError } from '@/server/lib/omp/rpc/constants';
import { cancelQueuedDelivery } from '@/server/lib/queue/delivery.server';
import { makeHarness, rejectionOf } from '@/server/lib/omp/rpc/session-commands-harness';
import { removeDir } from '@/test-support/remove-dir';

let root: string;
let savedDbPath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kabmo-test-'));
  savedDbPath = Bun.env.KABMO_DB_PATH;
  // The stream-status writes resolve the database; point them at the temp tree
  // so the real `~/.kabmo` is never created or opened.
  Bun.env.KABMO_DB_PATH = join(root, 'db.sqlite');
  delete globalThis.__kabmoDb;
});

afterEach(() => {
  cancelQueuedDelivery('sess-1');
  delete globalThis.__kabmoDb;
  if (savedDbPath === undefined) delete Bun.env.KABMO_DB_PATH;
  else Bun.env.KABMO_DB_PATH = savedDbPath;
  removeDir(root);
});

describe('steer and follow_up', () => {
  test('an idle session refuses both', async () => {
    const h = makeHarness();
    for (const type of ['steer', 'follow_up']) {
      const error = await rejectionOf(dispatchSessionCommand(h.host, { type, message: 'hi' }));
      expect((error as WebRpcError).code).toBe('session_idle');
    }
    expect(h.calls).toEqual([]);
  });

  test('a running session forwards the message', async () => {
    const h = makeHarness({ isRunning: () => true });
    await dispatchSessionCommand(h.host, { type: 'steer', message: 'stop that' });
    expect(h.calls).toEqual([{ type: 'steer', message: 'stop that' }]);
  });

  test('a pending dialog does NOT refuse a steer — omp queues it before parking', async () => {
    const h = makeHarness({ isRunning: () => true });
    h.pendingDialogs.push({ type: 'extension_ui_request', method: 'select' });
    await dispatchSessionCommand(h.host, { type: 'steer', message: 'still delivered' });
    expect(h.calls).toEqual([{ type: 'steer', message: 'still delivered' }]);
  });

  test('a late ack times out instead of destroying the child', async () => {
    // omp queues the steer and then holds the ack behind a blocking dialog, so
    // a timeout here means "delivered, unacknowledged" — the child must survive.
    const h = makeHarness({ isRunning: () => true });
    h.respond(() => Promise.reject(new RpcCommandTimeoutError('steer', 1)));
    const error = await rejectionOf(dispatchSessionCommand(h.host, { type: 'steer', message: 'slow' }));
    expect(error).toBeInstanceOf(RpcCommandTimeoutError);
    expect(h.counters.destroys).toBe(0);
  });
});


describe('commands blocked by a pending dialog', () => {
  test('abort is refused by name rather than left to hang', async () => {
    // Measured against omp 18.7.0: with a `select` dialog pending, `abort` and
    // `abort_and_prompt` never ack (both timed out at 15-20 s). Refusing turns
    // a hung HTTP request into an instruction the user can act on.
    const h = makeHarness();
    h.pendingDialogs.push({ type: 'extension_ui_request', method: 'select' });
    const error = await rejectionOf(dispatchSessionCommand(h.host, { type: 'abort' }));
    expect((error as WebRpcError).code).toBe('session_blocked_on_dialog');
    expect((error as WebRpcError).message).toContain('approval dialog');
    expect(h.calls).toEqual([]);
  });

  test('abort_and_prompt is refused too', async () => {
    const h = makeHarness();
    h.pendingDialogs.push({ type: 'extension_ui_request', method: 'select' });
    const error = await rejectionOf(dispatchSessionCommand(h.host, { type: 'abort_and_prompt', message: 'pivot' }));
    expect((error as WebRpcError).code).toBe('session_blocked_on_dialog');
    expect(h.calls).toEqual([]);
  });

  test('force_reset stays reachable — it is the escape hatch from a blocked child', async () => {
    const h = makeHarness();
    h.pendingDialogs.push({ type: 'extension_ui_request', method: 'select' });
    await dispatchSessionCommand(h.host, { type: 'force_reset' });
    expect(h.counters.destroys).toBe(1);
  });

  test('an answered dialog unblocks the same commands', async () => {
    const h = makeHarness();
    h.pendingDialogs.push({ type: 'extension_ui_request', id: 'ui-1', method: 'select' });
    expect((await rejectionOf(dispatchSessionCommand(h.host, { type: 'abort' })) as WebRpcError).code)
      .toBe('session_blocked_on_dialog');

    h.pendingDialogs.length = 0;
    await dispatchSessionCommand(h.host, { type: 'abort' });
    expect(h.calls).toEqual([{ type: 'abort' }]);
  });
});

