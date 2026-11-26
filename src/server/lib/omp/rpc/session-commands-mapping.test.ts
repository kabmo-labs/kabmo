/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The verb→RPC mapping of the session command dispatcher, and the two
 * non-command verbs: answering a parked extension dialog and the verbatim
 * passthrough.
 *
 * Every case is a place where a wrong mapping is a user-visible lie — a rename
 * that keeps its padding, a model identity the ack did not resolve, an
 * `abort_compaction` that arrives as something else, a shell command admitted
 * over a live turn. Split from `session-commands.test.ts` so that suite stays
 * under the repo's per-file size ceiling; the host and the process are fakes, no
 * omp child is spawned.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { dispatchSessionCommand } from '@kabmo-labs/kabmo-omp-rpc-commands/session-commands';
import { cancelQueuedDelivery } from '@/server/lib/queue/delivery.server';
import { makeHarness, rejectionOf } from '@/server/lib/omp/rpc/session-commands-harness';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  cancelQueuedDelivery('sess-1');
  await releaseDb();
});

describe('argument mapping', () => {
  test('set_session_name trims and refuses a blank name', async () => {
    const h = makeHarness();
    expect(String(await rejectionOf(dispatchSessionCommand(h.host, { type: 'set_session_name', name: '   ' })))).toContain(
      'Session name cannot be empty',
    );
    expect(String(await rejectionOf(dispatchSessionCommand(h.host, { type: 'set_session_name' })))).toContain(
      'Session name cannot be empty',
    );
    expect(h.calls).toEqual([]);
    await dispatchSessionCommand(h.host, { type: 'set_session_name', name: '  My chat  ' });
    expect(h.calls).toEqual([{ type: 'set_session_name', name: 'My chat' }]);
  });

  test('set_model returns only the identity pair, and read/abort aliases map correctly', async () => {
    const h = makeHarness();
    h.respond(() => ({ id: 'm1', provider: 'p1', name: 'ignored', contextWindow: 1 }));
    expect(await dispatchSessionCommand(h.host, { type: 'set_model', provider: 'p1', modelId: 'm1' })).toEqual({
      id: 'm1',
      provider: 'p1',
    });
    // The ack's RESOLVED pair is what a later prompt dispatch persists on the
    // stream row for the generating indicator.
    expect(h.host.runModel).toEqual({ provider: 'p1', modelId: 'm1' });
    expect(await dispatchSessionCommand(h.host, { type: 'abort_compaction' })).toBeNull();
    h.respond(() => ({ commands: [{ name: 'x' }] }));
    expect(await dispatchSessionCommand(h.host, { type: 'get_commands' })).toEqual({ commands: [{ name: 'x' }] });
    expect(h.calls).toEqual([
      { type: 'set_model', provider: 'p1', modelId: 'm1' },
      { type: 'abort' },
      { type: 'get_available_commands' },
    ]);
  });

  test('set_fast_mode only treats the literal true as enabled', async () => {
    const h = makeHarness();
    h.respond(() => ({}));
    expect(await dispatchSessionCommand(h.host, { type: 'set_fast_mode', enabled: 'yes' })).toEqual({ enabled: false, active: false });
    h.respond(() => ({ enabled: true, active: true }));
    expect(await dispatchSessionCommand(h.host, { type: 'set_fast_mode', enabled: true })).toEqual({ enabled: true, active: true });
    expect(h.host.fastModeEnabled).toBe(true);
    expect(h.calls).toEqual([{ type: 'set_fast_mode', enabled: false }, { type: 'set_fast_mode', enabled: true }]);
  });

  test('compact forwards custom instructions only when present', async () => {
    const h = makeHarness();
    await dispatchSessionCommand(h.host, { type: 'compact' });
    await dispatchSessionCommand(h.host, { type: 'compact', customInstructions: 'keep the plan' });
    expect(h.calls).toEqual([{ type: 'compact' }, { type: 'compact', customInstructions: 'keep the plan' }]);
    expect(h.host.compacting).toBe(false);
  });

  test('bash refuses while the session is busy and clears the flag after', async () => {
    const h = makeHarness({ isRunning: () => true });
    expect(String(await rejectionOf(dispatchSessionCommand(h.host, { type: 'bash', command: 'ls' })))).toContain(
      'Cannot run a shell command while the session is busy',
    );
    const idle = makeHarness();
    await dispatchSessionCommand(idle.host, { type: 'bash', command: 'ls' });
    expect(idle.calls).toEqual([{ type: 'bash', command: 'ls' }]);
    expect(idle.host.bashRunning).toBe(false);
  });

  test('force_reset destroys the session without sending anything', async () => {
    const h = makeHarness();
    expect(await dispatchSessionCommand(h.host, { type: 'force_reset' })).toBeNull();
    expect(h.counters.destroys).toBe(1);
    expect(h.calls).toEqual([]);
  });
});

describe('extension_ui_response', () => {
  test('requires an id and otherwise writes a frame without awaiting a response', async () => {
    const h = makeHarness();
    expect(String(await rejectionOf(dispatchSessionCommand(h.host, { type: 'extension_ui_response', result: 'ok' })))).toContain(
      'extension_ui_response requires an id',
    );
    expect(await dispatchSessionCommand(h.host, { type: 'extension_ui_response', id: 'ui-1', result: 'ok' })).toBeNull();
    expect(h.calls).toEqual([]);
    expect(h.frames).toEqual([{ type: 'extension_ui_response', id: 'ui-1', result: 'ok' }]);
    expect(h.counters.resolvedDialogs).toEqual(['ui-1']);
  });
});

describe('passthrough', () => {
  test('the command is forwarded verbatim and an empty ack reads as null', async () => {
    const h = makeHarness();
    expect(await dispatchSessionCommand(h.host, { type: 'get_messages', limit: 5 })).toBeNull();
    expect(h.calls).toEqual([{ type: 'get_messages', limit: 5 }]);
  });

  test('the ack payload is returned unchanged', async () => {
    const h = makeHarness();
    h.respond(() => ({ messages: ['a'] }));
    expect(await dispatchSessionCommand(h.host, { type: 'get_messages_page' })).toEqual({ messages: ['a'] });
  });
});
