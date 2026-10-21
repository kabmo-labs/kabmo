/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The waiting-prompt sweep: what it dispatches, what it holds, and what happens
 * when the dispatch fails.
 *
 * Every outside dependency is INJECTED (`WaitingDeps`), never mocked through
 * `mock.module` — that swaps a registry entry for the whole `bun test` run and
 * broke six unrelated suites the last time it was tried here. Injection keeps
 * the blast radius inside this file, and the rules worth pinning are all about
 * ORDER rather than about omp:
 *
 *   - a prompt is dispatched exactly once, even for two sweeps that race;
 *   - a dependency with a queue still waiting holds the prompt;
 *   - a dispatch that throws is retried, then reported, and never silently
 *     dropped;
 *   - the prompt carries its attachments and its model snapshot.
 */

import { describe, expect, test } from 'bun:test';
import { sweepWaitingPrompts, MAX_DISPATCH_ATTEMPTS, type StreamRowMap, type WaitingDeps } from '@/server/lib/waiting/runtime.server';
import type { Attachment } from '@/shared/types/chat';
import type { WaitingPrompt } from '@/shared/types/waiting';

const NOW = 1_800_000_000_000;
const OLD = NOW - 60_000;

function prompt(overrides: Partial<WaitingPrompt> = {}): WaitingPrompt {
  return {
    id: 'wait-1',
    pendingId: 'new-1',
    dependsOn: 'dep-a',
    dependsOnTitle: 'Session A',
    prompt: 'do the thing',
    attachments: [],
    model: null,
    modes: null,
    cwd: '/tmp/project',
    folderId: 1,
    status: 'waiting',
    sessionId: null,
    error: null,
    createdAt: OLD,
    updatedAt: OLD,
    ...overrides,
  };
}

interface Harness {
  deps: WaitingDeps;
  /** Commands sent to each spawned session, in order. */
  sent: Record<string, Record<string, unknown>[]>;
  /** Session ids spawned, in order. */
  spawned: string[];
  /** Calls that changed a row, as `verb id`. */
  writes: string[];
  setStreams(rows: StreamRowMap): void;
  setRowWrittenAt(at: number | null): void;
  setQueued(queued: boolean): void;
  setDelivering(delivering: boolean): void;
  failSpawnWith(error: Error | null): void;
  failSendWith(error: Error | null): void;
}

function harness(initial: WaitingPrompt[] = [prompt()]): Harness {
  // The attempt counter is the store's own column, not part of the client-facing
  // shape: the harness keeps it beside the rows rather than widening `WaitingPrompt`.
  const attempts = new Map<string, number>();
  let rows = initial.map((row) => ({ ...row }));
  let streams: StreamRowMap = { 'dep-a': { status: 'finish' } };
  let rowWrittenAt: number | null = OLD;
  let queued = false;
  let delivering = false;
  let spawnError: Error | null = null;
  let sendError: Error | null = null;
  const sent: Harness['sent'] = {};
  const spawned: string[] = [];
  const writes: string[] = [];
  let spawnCount = 0;

  const deps: WaitingDeps = {
    async startNewRpcSession() {
      if (spawnError) throw spawnError;
      spawnCount += 1;
      const id = `spawned-${spawnCount}`;
      spawned.push(id);
      sent[id] = [];
      return {
        realSessionId: id,
        session: {
          async send(command) {
            if (sendError) throw sendError;
            sent[id].push(command);
            return null;
          },
        },
      };
    },
    getSession: () => undefined,
    loadStreamStates: async () => streams,
    streamRowWrittenAt: async () => rowWrittenAt,
    hasQueuedItem: async () => queued,
    hasPendingDelivery: () => delivering,
    loadPersistedAccessMode: async () => 'always-ask',
    listWaitingPrompts: async () => rows.map((row) => ({ ...row })),
    claimWaitingPrompt: async (id) => {
      const row = rows.find((entry) => entry.id === id);
      if (!row || row.status !== 'waiting') return false;
      row.status = 'dispatched';
      writes.push(`claim ${id}`);
      return true;
    },
    countWaitingAttempt: async (id) => {
      const next = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, next);
      return next;
    },
    markWaitingDispatched: async (id, sessionId) => {
      const row = rows.find((entry) => entry.id === id);
      if (row) {
        row.status = 'dispatched';
        row.sessionId = sessionId;
      }
      writes.push(`dispatched ${id} ${sessionId}`);
    },
    requeueWaitingPrompt: async (id) => {
      const row = rows.find((entry) => entry.id === id);
      if (row) row.status = 'waiting';
      writes.push(`requeue ${id}`);
    },
    failWaitingPrompt: async (id, error) => {
      const row = rows.find((entry) => entry.id === id);
      if (row) {
        row.status = 'error';
        row.error = error;
      }
      writes.push(`fail ${id}`);
    },
    pruneWaitingPrompts: async () => 0,
  };

  return {
    deps,
    sent,
    spawned,
    writes,
    setStreams: (next) => {
      streams = next;
    },
    setRowWrittenAt: (next) => {
      rowWrittenAt = next;
    },
    setQueued: (next) => {
      queued = next;
    },
    setDelivering: (next) => {
      delivering = next;
    },
    failSpawnWith: (error) => {
      spawnError = error;
    },
    failSendWith: (error) => {
      sendError = error;
    },
  };
}

describe('sweepWaitingPrompts', () => {
  test('dispatches a prompt once its dependency has finished', async () => {
    const h = harness();
    expect(await sweepWaitingPrompts({ now: NOW, deps: h.deps })).toBe(1);
    expect(h.spawned).toEqual(['spawned-1']);
    expect(h.sent['spawned-1']).toEqual([{ type: 'prompt', message: 'do the thing' }]);
    expect(h.writes).toContain('dispatched wait-1 spawned-1');
  });

  test('holds the prompt while the dependency still has a queued follow-up', async () => {
    const h = harness();
    h.setQueued(true);
    expect(await sweepWaitingPrompts({ now: NOW, deps: h.deps })).toBe(0);
    expect(h.spawned).toEqual([]);
  });

  test('holds the prompt while the dependency is still streaming', async () => {
    const h = harness();
    h.setStreams({ 'dep-a': { status: 'stream' } });
    expect(await sweepWaitingPrompts({ now: NOW, deps: h.deps })).toBe(0);
  });

  // The row's clock is what closes the gap between a run end and the queue it
  // arms 500 ms later, so a freshly written row must not release anything yet.
  test('holds the prompt until the status row has aged past the grace', async () => {
    const h = harness();
    h.setRowWrittenAt(NOW - 100);
    expect(await sweepWaitingPrompts({ now: NOW, deps: h.deps })).toBe(0);
    expect(h.spawned).toEqual([]);
  });

  test('holds the prompt while a delivery slot is armed', async () => {
    const h = harness();
    h.setDelivering(true);
    expect(await sweepWaitingPrompts({ now: NOW, deps: h.deps })).toBe(0);
  });

  // The claim is the concurrency answer: the second sweep must not spawn again.
  test('two sweeps racing spawn exactly one session', async () => {
    const h = harness();
    const [first, second] = await Promise.all([
      sweepWaitingPrompts({ now: NOW, deps: h.deps }),
      sweepWaitingPrompts({ now: NOW, deps: h.deps }),
    ]);
    expect(first + second).toBe(1);
    expect(h.spawned).toHaveLength(1);
  });

  test('a failed spawn returns the prompt to waiting instead of losing it', async () => {
    const h = harness();
    h.failSpawnWith(new Error('omp did not start'));
    expect(await sweepWaitingPrompts({ now: NOW, deps: h.deps })).toBe(0);
    expect(h.writes).toContain('requeue wait-1');
    expect(h.writes).not.toContain('fail wait-1');
  });

  test('a prompt whose dispatch keeps failing is reported, not retried forever', async () => {
    const h = harness();
    h.failSpawnWith(new Error('omp did not start'));
    for (let attempt = 0; attempt < MAX_DISPATCH_ATTEMPTS; attempt += 1) {
      await sweepWaitingPrompts({ now: NOW, deps: h.deps });
    }
    expect(h.writes.filter((write) => write.startsWith('fail '))).toHaveLength(1);
  });

  // The wrapper's `send` reads its own runtime state through `this`, so a
  // dispatch that passes the method detached runs against `undefined` — the
  // real failure was `undefined is not an object (evaluating 'host.restarting')`
  // on every prompt. The harness's send is an object METHOD for that reason,
  // and this asserts the dispatcher never loses its receiver.
  test('sends through the session, never a detached method', async () => {
    const h = harness();
    let receiver: unknown = null;
    h.deps.startNewRpcSession = async () => {
      const session = {
        async send(this: unknown) {
          receiver = this;
          return null;
        },
      };
      return { realSessionId: 'spawned-x', session };
    };
    await sweepWaitingPrompts({ now: NOW, deps: h.deps });
    expect(receiver).not.toBeUndefined();
  });

  test('carries the attachment bytes and the model snapshot', async () => {
    const attachment: Attachment = { id: 'a1', preview: '', name: 'shot.png', type: 'image/png', dataBase64: 'AAA' };
    const h = harness([
      prompt({
        attachments: [attachment],
        model: { provider: 'anthropic', modelId: 'claude', thinkingLevel: 'high', accessMode: 'yolo' },
      }),
    ]);
    await sweepWaitingPrompts({ now: NOW, deps: h.deps });
    const commands = h.sent['spawned-1'];
    expect(commands[0]).toEqual({ type: 'set_model', provider: 'anthropic', modelId: 'claude' });
    expect(commands[1]).toEqual({ type: 'set_thinking_level', level: 'high' });
    expect(commands[2]).toMatchObject({ type: 'prompt', accessMode: 'yolo' });
    expect((commands[2].images as { data: string }[])[0]?.data).toBe('AAA');
  });

  test('nothing is read or spawned when no prompt is waiting', async () => {
    const h = harness([prompt({ status: 'dispatched', sessionId: 'done' })]);
    expect(await sweepWaitingPrompts({ now: NOW, deps: h.deps })).toBe(0);
    expect(h.spawned).toEqual([]);
  });
});
