/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shared `/rename` request lifecycle: claims, dispatch order, and the
 * barrier a following prompt waits on.
 *
 * Each rule here was a defect measured against a real child:
 *
 *   - a single claim slot meant the SECOND attempt's claim overwrote the first,
 *     so the first one's `command_output` reached the timeline as a notice row;
 *   - unserialized dispatches raced, and omp cancels a superseded rename
 *     WITHOUT emitting the frame that releases its claim;
 *   - a prompt admitted before a finished run's rename let the rename name a
 *     conversation that had already moved on.
 */

import { describe, expect, test } from 'bun:test';

import {
  awaitTitleDispatch,
  consumeAutoTitleOutput,
  markTitleRequestSent,
  releaseTitleClaim,
  sendTitleRequest,
  waitForTitleOutcome,
  type TitleRequestHost,
} from '@/server/lib/omp/session/title-request.server';

interface FakeProc {
  commands: Array<Record<string, unknown>>;
  /** Held open so a test controls when a dispatch acknowledges. */
  gate?: Promise<void>;
  sendCommand<T>(command: { type: string; [key: string]: unknown }): Promise<T>;
}

function makeHost(options: { gate?: Promise<void> } = {}): { host: TitleRequestHost; proc: FakeProc } {
  const proc: FakeProc = {
    commands: [],
    gate: options.gate,
    async sendCommand<T>(command: { type: string; [key: string]: unknown }): Promise<T> {
      proc.commands.push(command);
      if (command.type === 'prompt' && proc.gate) await proc.gate;
      return undefined as T;
    },
  };
  const host: TitleRequestHost = {
    sessionId: 'sess-1',
    autoTitleWindowUntil: 0,
    autoTitleClaims: 0,
    autoTitleDispatch: null,
    proc,
  };
  return { host, proc };
}

describe('title claims', () => {
  test('one claim per request, and a second frame passes through', () => {
    const { host } = makeHost();
    markTitleRequestSent(host);

    expect(consumeAutoTitleOutput(host)).toBe(true);
    // The operator's own command output must reach the timeline.
    expect(consumeAutoTitleOutput(host)).toBe(false);
  });

  test('two outstanding requests keep two claims', () => {
    // The early attempt and the settle fallback can both be unanswered at once.
    // One slot let the first one's frame render as a notice row.
    const { host } = makeHost();
    markTitleRequestSent(host);
    markTitleRequestSent(host);

    expect(host.autoTitleClaims).toBe(2);
    expect(consumeAutoTitleOutput(host)).toBe(true);
    expect(consumeAutoTitleOutput(host)).toBe(true);
    expect(consumeAutoTitleOutput(host)).toBe(false);
    expect(host.autoTitleWindowUntil).toBe(0);
  });

  test('an expired claim is dropped instead of swallowing an operator frame', () => {
    const { host } = makeHost();
    markTitleRequestSent(host);
    host.autoTitleWindowUntil = Date.now() - 1;

    expect(consumeAutoTitleOutput(host)).toBe(false);
    expect(host.autoTitleClaims).toBe(0);
  });

  test('a release keeps the window armed while another claim is live', () => {
    const { host } = makeHost();
    markTitleRequestSent(host);
    markTitleRequestSent(host);

    releaseTitleClaim(host);
    expect(host.autoTitleWindowUntil).toBeGreaterThan(Date.now());
  });
});

/** Drain the microtask queue, so a promise that WOULD have resolved has. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe('dispatch order', () => {
  test('a second request is dispatched only after the first acknowledges', async () => {
    const { promise: gate, resolve: open } = Promise.withResolvers<void>();
    const { host, proc } = makeHost({ gate });

    // The slot is owned by the CALLER, exactly as `triggerAutoSessionTitle`
    // claims it before the first await.
    const first = sendTitleRequest(host, '/rename', null);
    host.autoTitleDispatch = first.then(
      () => undefined,
      () => undefined,
    );
    const second = sendTitleRequest(host, '/rename', host.autoTitleDispatch);
    await flush();
    expect(proc.commands).toHaveLength(1);

    open();
    await Promise.all([first, second]);
    expect(proc.commands).toHaveLength(2);
  });

  test('a prompt that follows waits for the dispatch already in flight', async () => {
    const { promise: gate, resolve: open } = Promise.withResolvers<void>();
    const { host, proc } = makeHost({ gate });

    const pending = sendTitleRequest(host, '/rename', null);
    host.autoTitleDispatch = pending.then(
      () => undefined,
      () => undefined,
    );

    let released = false;
    const barrier = awaitTitleDispatch(host).then(() => {
      released = true;
    });
    // The dispatch has not acknowledged yet, so the barrier must still be
    // waiting — this is the ordering the requirement depends on. Nothing but
    // `open()` can resolve it, so a microtask flush is a complete check.
    await flush();
    expect(released).toBe(false);
    expect(proc.commands).toHaveLength(1);

    open();
    await Promise.all([pending, barrier]);
    expect(released).toBe(true);
  });

  test('the barrier is a no-op when nothing is in flight', async () => {
    const { host } = makeHost();
    await awaitTitleDispatch(host);
    expect(host.autoTitleDispatch).toBeNull();
  });
});

describe('waiting for the outcome', () => {
  test('resolves when the claim is consumed, so the model pin outlives the ack', async () => {
    const { host } = makeHost();
    markTitleRequestSent(host);

    let done = false;
    const waiting = waitForTitleOutcome(host, 50).then(() => {
      done = true;
    });
    await flush();
    expect(done).toBe(false);

    consumeAutoTitleOutput(host);
    await waiting;
    expect(done).toBe(true);
  });

  test('resolves immediately when no request is outstanding', async () => {
    const { host } = makeHost();
    await waitForTitleOutcome(host, 50);
    expect(host.autoTitleClaims).toBe(0);
  });
});
