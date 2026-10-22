/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two properties "Rename with AI" must not lose.
 *
 * 1. It waits for omp's ANSWER, not for the send. `/rename` is acknowledged
 *    immediately (`{agentInvoked:false}`) while the title arrives seconds later
 *    on its own frame, so a route that returned on the ack would report success
 *    with no name and the row would keep its old title.
 * 2. Success and refusal are told apart by WHICH frame lands, and only a real
 *    title is success. A refusal ("Could not generate a session title") arrives
 *    as `command_output` and must never be reported as a rename.
 *
 * The frame shapes here are the ones measured against a live omp child
 * (18.3.x): `session_info_update {title}` then `command_output {text}`.
 *
 * No wall-clock waiting: the fake proc resolves the send immediately, and each
 * test drives the frames itself, so the ordering under test is explicit.
 */

import { describe, expect, test } from 'bun:test';

import { awaitTitleFrame, type TitleFrameHost } from '@/server/lib/omp/session/rename-with-ai.server';

type Frame = { type: string; [key: string]: unknown };

interface FakeProc {
  commands: Array<Record<string, unknown>>;
  emit(frame: Frame): void;
  sendCommand<T>(command: { type: string; [key: string]: unknown }): Promise<T>;
  /** Resolves once `/rename` has been dispatched. */
  sent: Promise<void>;
}

function makeHost(
  options: { sendFails?: boolean; onSend?: (host: TitleFrameHost) => void } = {},
): { host: TitleFrameHost; proc: FakeProc } {
  const listeners = new Set<(frame: Frame) => void>();
  const sent = Promise.withResolvers<void>();
  const proc: FakeProc = {
    commands: [],
    sent: sent.promise,
    emit(frame) {
      for (const listener of [...listeners]) listener(frame);
    },
    async sendCommand<T>(command: { type: string; [key: string]: unknown }): Promise<T> {
      proc.commands.push(command);
      options.onSend?.(host);
      sent.resolve();
      if (options.sendFails) throw new Error('omp RPC process has exited');
      // omp acks /rename before it has a title — the case that makes waiting
      // for the frame, rather than for the ack, the whole point.
      return { agentInvoked: false } as T;
    },
  };

  const host = {
    sessionId: 'sess-1',
    autoTitleWindowUntil: 0,
    autoTitleClaims: 0,
    autoTitleDispatch: null,
    autoTitlePending: false,
    autoTitleRequested: false,
    autoTitleModel: null,
    proc: {
      sendCommand: proc.sendCommand,
      onFrame(listener: (frame: Frame) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };

  return { host: host as unknown as TitleFrameHost, proc };
}

describe('renameSessionWithAi frame handling', () => {
  test('the ack alone is not success — the title frame is', async () => {
    const { host, proc } = makeHost();
    const pending = awaitTitleFrame(host);

    await proc.sent;
    expect(proc.commands.some((c) => c.type === 'prompt' && c.message === '/rename')).toBe(true);

    proc.emit({ type: 'session_info_update', title: 'SQLx pool health check demo' });
    expect(await pending).toEqual({ ok: true, title: 'SQLx pool health check demo' });
  });

  test('a command_output without a title is a refusal, not a rename', async () => {
    const { host, proc } = makeHost();
    const pending = awaitTitleFrame(host);
    await proc.sent;

    proc.emit({ type: 'command_output', text: 'Could not generate a session title' });
    expect(await pending).toEqual({
      ok: false,
      error: 'Could not generate a session title',
      status: 502,
    });
  });

  test('an empty session_info_update is not accepted as a name', async () => {
    const { host, proc } = makeHost();
    const pending = awaitTitleFrame(host);
    await proc.sent;

    proc.emit({ type: 'session_info_update', title: '   ' });
    proc.emit({ type: 'command_output', text: 'Could not generate a session title' });
    expect(await pending).toEqual({
      ok: false,
      error: 'Could not generate a session title',
      status: 502,
    });
  });

  test('a send that never reached omp is reported, not left hanging', async () => {
    const { host } = makeHost({ sendFails: true });
    expect(await awaitTitleFrame(host)).toMatchObject({ ok: false, status: 502 });
  });

  test('the request claims the output window before sending, so the frames stay out of the timeline', async () => {
    let claimsAtSend = -1;
    const { host, proc } = makeHost({
      onSend: (h) => {
        claimsAtSend = h.autoTitleClaims;
      },
    });
    const pending = awaitTitleFrame(host);

    // Armed before the `prompt` reaches the wire, not on its ack: omp answers
    // within the same tick (measured ~3 ms), so a claim armed after the ack can
    // already be too late for the frame it was meant to cover.
    await proc.sent;
    expect(claimsAtSend).toBe(1);
    expect(host.autoTitleWindowUntil).toBeGreaterThan(Date.now());

    proc.emit({ type: 'session_info_update', title: 'Named' });
    await pending;
  });

  test('a failed send releases the window it claimed', async () => {
    const { host } = makeHost({ sendFails: true });
    await awaitTitleFrame(host);
    expect(host.autoTitleWindowUntil).toBe(0);
  });
});
