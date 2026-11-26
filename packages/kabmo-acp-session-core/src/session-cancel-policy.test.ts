/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What Stop does to a parked approval, per protocol major.
 *
 * v1: the agent waits on the answer, so the client MUST answer `cancelled`.
 * v2: only the agent knows which request belongs to the cancelled foreground
 * work (requests for background work stay open), so the client must NOT answer
 * them — Zed models the same difference as
 * `answers_permission_requests_on_cancel() === false` on its v2 connection.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { flushTicks, mountSession } from './session.test-util';
import type { AcpSession } from './session';

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

type RequestAnswer = { answered: boolean };

/** The private transport hook the mount does not re-export; named once here
 *  rather than cast at each call site. */
interface ClientRequestSeam {
  onClientRequest: (id: string, method: string, params: Record<string, unknown>) => Promise<RequestAnswer>;
}

function parkPermission(session: AcpSession, sessionId = 'acp-1'): Promise<RequestAnswer> {
  const seam = session as unknown as ClientRequestSeam;
  return seam.onClientRequest.call(session, 'req-1', 'session/request_permission', {
    sessionId,
    toolCall: { toolCallId: 'call-1', title: 'Run build', kind: 'execute' },
    options: [
      { optionId: 'once', kind: 'allow_once' },
      { optionId: 'no', kind: 'reject_once' },
    ],
  });
}

describe('ACP stop vs parked approvals', () => {
  test('v1 answers every parked approval with cancelled', async () => {
    const { session, permissionAnswers } = mountSession();
    await parkPermission(session);
    expect(permissionAnswers()).toHaveLength(0);

    session.cancelTurn();
    await flushTicks();
    expect(permissionAnswers()).toEqual([
      { id: 'req-1', result: { outcome: { outcome: 'cancelled' } } },
    ]);
    expect(session.permissions.size()).toBe(0);
  });

  test('v2 leaves the approval open for the agent to cancel', async () => {
    const { session, permissionAnswers } = mountSession();
    // The stub process is the transport seam the mount installs.
    const transport = session as unknown as { proc: { protocolVersion: number } };
    transport.proc.protocolVersion = 2;
    await parkPermission(session);

    session.cancelTurn();
    await flushTicks();
    expect(permissionAnswers()).toHaveLength(0);
    expect(session.permissions.size()).toBe(1);
  });

  test('a child approval names the child and records its own session id', async () => {
    const { session, events } = mountSession();
    session.subagents.apply({ sessionId: 'child-1', title: 'Investigator' });
    await parkPermission(session, 'child-1');

    const dialog = events.find((event) => event.type === 'extension_ui_request');
    expect(dialog?.title).toBe('Investigator — Run build');
    // The dialog body falls back to the title, so both name the child.
    expect(session.permissions.pendingDialogs()[0]?.message).toBe('Investigator — Run build');
  });
});
