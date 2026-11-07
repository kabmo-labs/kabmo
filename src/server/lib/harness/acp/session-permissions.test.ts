/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The access tier decides whether a permission request ever reaches the user.
 *
 * ACP has no `--approval-mode` flag: the CLIENT answers
 * `session/request_permission`. That made the composer's access control inert
 * on this transport (measured: "Full bypass" still raised the approval dialog
 * for a bash call), and the tiers below are omp's own contract, so one label
 * means one thing on both transports.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { mountSession } from '@/server/lib/harness/acp/session.test-util';
import type { AcpSession } from '@/server/lib/harness/acp/session';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';

// A prompt reaches the title writer, which opens the database — isolate it.
beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

interface PermissionHost {
  accessMode: string;
  onClientRequest: (
    id: number,
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
}

const request = (kind: string): Record<string, unknown> => ({
  sessionId: 'acp-1',
  toolCall: { kind, title: `${kind} thing` },
  options: [
    { optionId: 'deny', kind: 'reject_once' },
    { optionId: 'allow', kind: 'allow_once' },
  ],
});

const permission = (session: AcpSession, id: number, kind: string): Promise<unknown> =>
  (session as unknown as PermissionHost).onClientRequest(id, 'session/request_permission', request(kind));

const dialogs = (events: AgentEvent[]): number =>
  events.filter((event) => event.type === 'extension_ui_request').length;

describe('ACP permission gating', () => {
  test('`yolo` answers an exec request itself, with no dialog', async () => {
    const { session, events } = mountSession();
    (session as unknown as PermissionHost).accessMode = 'yolo';
    expect(await permission(session, 7, 'execute')).toEqual({
      answered: true,
      result: { outcome: { outcome: 'selected', optionId: 'allow' } },
    });
    expect(dialogs(events)).toBe(0);
    expect(session.isBusy()).toBe(false);
  });

  test('`always-ask` still parks an exec request as a dialog', async () => {
    const { session, events } = mountSession();
    expect(await permission(session, 8, 'execute')).toEqual({ answered: false, deferred: true });
    expect(dialogs(events)).toBe(1);
    expect(session.isBusy()).toBe(true);
  });

  test('`always-ask` auto-runs a read-tier request, as omp does', async () => {
    const { session } = mountSession();
    expect(await permission(session, 9, 'read')).toMatchObject({ answered: true });
  });

  test('`write` auto-runs edits and still asks for exec', async () => {
    const { session } = mountSession();
    (session as unknown as PermissionHost).accessMode = 'write';
    expect(await permission(session, 10, 'edit')).toMatchObject({ answered: true });
    expect(await permission(session, 11, 'execute')).toEqual({ answered: false, deferred: true });
  });

  test('a request with no allow option still reaches the user', async () => {
    const { session, events } = mountSession();
    (session as unknown as PermissionHost).accessMode = 'yolo';
    const answer = await (session as unknown as PermissionHost).onClientRequest(12, 'session/request_permission', {
      sessionId: 'acp-1',
      toolCall: { kind: 'execute' },
      options: [{ optionId: 'deny', kind: 'reject_once' }],
    });
    expect(answer).toEqual({ answered: false, deferred: true });
    expect(dialogs(events)).toBe(1);
  });

  test('a prompt carrying the access pick adopts it before the turn', async () => {
    const { session, turn } = mountSession();
    await session.send({ type: 'prompt', message: 'hi', accessMode: 'yolo' });
    await turn.started;
    expect((session as unknown as PermissionHost).accessMode).toBe('yolo');
    turn.finish({ stopReason: 'end_turn' });
  });
});
