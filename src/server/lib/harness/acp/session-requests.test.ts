/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Agent→client request routing.
 *
 * The two branches that are easy to get wrong: an unimplemented method must
 * answer `-32601` (an agent falls back on that; an internal error looks like a
 * client bug), and the advertised fs surface must actually be served rather
 * than refused.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PendingPermissions } from '@/server/lib/harness/acp/permissions';
import { handleAcpClientRequest, type AcpClientRequestHost } from '@/server/lib/harness/acp/session-requests';
import { ACP_ERROR } from '@/server/lib/harness/acp/protocol';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';

const scratch: string[] = [];

function host(cwd = '/tmp', protocol: 1 | 2 = 1): AcpClientRequestHost {
  return {
    sessionId: 's1',
    cwd,
    protocol,
    accessMode: 'always-ask',
    permissions: new PendingPermissions(),
    emit: (_event: AgentEvent) => {},
  };
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('handleAcpClientRequest', () => {
  test('an unimplemented method is refused with method-not-found', async () => {
    const answer = await handleAcpClientRequest(host(), 1, 'terminal/create', {
      sessionId: 's1',
      command: 'ls',
    });
    expect(answer).toEqual({
      answered: false,
      message: 'Kabmo does not implement terminal/create',
      code: ACP_ERROR.methodNotFound,
    });
  });

  test('the advertised fs surface is served, not refused', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kabmo-acp-req-'));
    scratch.push(dir);
    await Bun.write(join(dir, 'a.txt'), 'hi');
    const answer = await handleAcpClientRequest(host(dir), 2, 'fs/read_text_file', {
      sessionId: 's1',
      path: join(dir, 'a.txt'),
    });
    expect(answer).toEqual({ answered: true, result: { content: 'hi' } });
  });

  test('a v2 tool_call subject is applied like the v1 tool call', async () => {
    const request = host('/tmp', 2);
    const answer = await handleAcpClientRequest(request, 3, 'session/request_permission', {
      sessionId: 's1',
      title: 'Read a file?',
      subject: { type: 'tool_call', toolCall: { toolCallId: 'c1', kind: 'read' } },
      options: [{ optionId: 'allow', kind: 'allow_once' }],
    });
    // `always-ask` auto-runs the read tier, exactly as it does for v1.
    expect(answer).toMatchObject({ answered: true, result: { outcome: { outcome: 'selected' } } });
    expect(request.permissions.size()).toBe(0);
  });

  test('a v2 command subject parks the dialog with the command visible', async () => {
    const request = host('/tmp', 2);
    const answer = await handleAcpClientRequest(request, 4, 'session/request_permission', {
      sessionId: 's1',
      title: 'Run the tests?',
      subject: { type: 'command', command: 'cargo test', cwd: '/repo' },
      options: [{ optionId: 'allow', kind: 'allow_once' }, { optionId: 'deny', kind: 'reject_once' }],
    });
    expect(answer).toEqual({ answered: false, deferred: true });
    expect(request.permissions.pendingDialogs()[0]).toMatchObject({
      title: 'Run the tests?',
      message: '$ cargo test',
    });
  });
});
