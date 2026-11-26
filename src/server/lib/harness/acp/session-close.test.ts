/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Ending an ACP session's life.
 *
 * Two rules are pinned here: a teardown Kabmo started reports no failure, and
 * the agent is told `session/close` BEFORE the pipe is torn down when it
 * advertised the verb. A dead parent also closes its children's cards — no
 * later frame will report their outcome.
 */

import { describe, expect, test } from 'bun:test';
import { acpExited, destroyAcp, type AcpLifecycleHost } from '@kabmo-labs/kabmo-acp-session/session-lifecycle';

function makeHost(overrides: Partial<AcpLifecycleHost> = {}) {
  const log: string[] = [];
  const host: AcpLifecycleHost = {
    destroyed: false,
    closing: false,
    idle: { stop: () => log.push('idle:stop') },
    background: { stop: () => log.push('background:stop') },
    permissions: { clear: () => log.push('permissions:clear'), size: () => 0 },
    finishSubagents: () => log.push('subagents:finish'),
    closeAgentSession: async () => {
      log.push('close');
    },
    runDestroyHook: () => log.push('destroy-hook'),
    disposeProcess: async () => {
      log.push('dispose');
    },
    reportExit: async () => {
      log.push('report');
    },
    ...overrides,
  };
  return { host, log };
}

describe('ACP session teardown', () => {
  test('close runs before dispose, and children are closed first', async () => {
    const { host, log } = makeHost();
    await destroyAcp(host);
    expect(log).toEqual([
      'background:stop',
      'idle:stop',
      'subagents:finish',
      'permissions:clear',
      'destroy-hook',
      'close',
      'dispose',
    ]);
    expect(host.destroyed).toBe(true);
  });

  test('a refused close does not stop the disposal', async () => {
    const { host, log } = makeHost({
      closeAgentSession: async () => {
        log.push('close');
        throw new Error('agent does not support session/close');
      },
    });
    await destroyAcp(host);
    expect(log).toContain('dispose');
  });

  test('a teardown Kabmo started reports nothing', async () => {
    const { host, log } = makeHost({ closing: true });
    await acpExited(host, { code: 0, stderrTail: '' });
    expect(log).toContain('subagents:finish');
    expect(log).not.toContain('report');
  });

  test('an agent that died mid-turn reports the exit', async () => {
    const { host, log } = makeHost();
    await acpExited(host, { code: 1, stderrTail: 'boom' });
    expect(log).toContain('report');
  });

  test('a second teardown is a no-op', async () => {
    const { host, log } = makeHost();
    await destroyAcp(host);
    const calls = log.length;
    await destroyAcp(host);
    expect(log).toHaveLength(calls);
  });
});
