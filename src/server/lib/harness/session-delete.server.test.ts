/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Removing a chat from the AGENT's own history.
 *
 * The reported defect: deleting an imported row (`dsh`, `opencode`) removed
 * Kabmo's rows and nothing else, so the next `session/list` import put the row
 * straight back. Each case below is one way the agent's copy is (or is not)
 * reachable:
 *
 *  - an agent that advertises `session/delete` is asked over a real child, and
 *    the id on the wire is the AGENT's id, not Kabmo's;
 *  - an agent with no such verb refuses — the delete route must not claim a
 *    removal that did not happen;
 *  - `dsh` keeps a directory Kabmo can name and does not implement the verb, so
 *    the store is removed WITHOUT spawning it;
 *  - omp sessions live in the JSONL the purge already removes.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentSessionRemover } from '@/server/lib/harness/session-delete.server';
import { fakeAcpDeleteAgent } from '@/test-support/fake-acp-delete';
import type { HarnessLaunch } from '@kabmo-labs/kabmo-harness-launch/launch-table';
import type { HarnessSessionRecord } from '@kabmo-labs/kabmo-harness-session/session-store.server';
import type { HarnessId } from '@kabmo-labs/kabmo-harness-catalog';

const scratch: string[] = [];
const saved = { dshHome: Bun.env.DSH_HOME, log: Bun.env.FAKE_ACP_DELETE_LOG };

let agent = '';
let deleteLog = '';

beforeEach(async () => {
  agent = await fakeAcpDeleteAgent();
  const dir = await mkdtemp(join(tmpdir(), 'kabmo-agent-delete-'));
  scratch.push(dir);
  deleteLog = join(dir, 'deleted.log');
  Bun.env.FAKE_ACP_DELETE_LOG = deleteLog;
});

afterEach(async () => {
  delete Bun.env.FAKE_ACP_DELETE_LOG;
  if (saved.dshHome === undefined) delete Bun.env.DSH_HOME;
  else Bun.env.DSH_HOME = saved.dshHome;
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function record(overrides: Partial<HarnessSessionRecord> = {}): HarnessSessionRecord {
  return {
    sessionId: 'kabmo-session-1',
    harness: 'opencode',
    agentSessionId: 'agent-session-1',
    cwd: '/tmp',
    origin: 'imported',
    ...overrides,
  };
}

/** A launch line that names the fake agent, never the installed binary. */
function fakeLaunch(harness: HarnessId): Promise<HarnessLaunch> {
  return Promise.resolve({
    id: harness,
    command: [agent],
    env: { FAKE_ACP_DELETE_LOG: deleteLog },
    note: 'test fixture',
  });
}

describe('agent-side session removal', () => {
  test('an agent that advertises delete is asked with its OWN session id', async () => {
    const remover = createAgentSessionRemover({ launch: fakeLaunch, storeDirs: async () => [] });
    try {
      expect(await remover.remove(record())).toEqual({ removed: true });
      expect(await Bun.file(deleteLog).text()).toBe('agent-session-1\n');
    } finally {
      await remover.dispose();
    }
  });

  test('an agent with no delete verb refuses instead of reporting a removal', async () => {
    // Reads the capability from the CHILD's env, so it must travel with the
    // launch line rather than the test process.
    const remover = createAgentSessionRemover({
      launch: async (harness) => ({
        ...(await fakeLaunch(harness)),
        env: { FAKE_ACP_DELETE_LOG: deleteLog, FAKE_ACP_DELETE_CAP: '0' },
      }),
      storeDirs: async () => [],
    });
    try {
      const result = await remover.remove(record());
      expect(result.removed).toBe(false);
      expect(result.error).toContain('opencode');
      expect(await Bun.file(deleteLog).exists()).toBe(false);
    } finally {
      await remover.dispose();
    }
  });

  test('a dsh session directory is removed without booting the agent', async () => {
    const home = await mkdtemp(join(tmpdir(), 'kabmo-dsh-home-'));
    scratch.push(home);
    Bun.env.DSH_HOME = home;
    const project = join(home, 'sessions', '--projects-demo--');
    const sessionDir = join(project, 'agent-session-1');
    await fs.promises.mkdir(sessionDir, { recursive: true });
    await Bun.write(join(sessionDir, 'session.v4.jsonl.zstd'), 'transcript');

    const remover = createAgentSessionRemover({
      // Throwing proves the store was handled locally: a spawn would surface
      // here as a failed removal instead.
      launch: () => Promise.reject(new Error('must not spawn dsh')),
    });
    try {
      expect(await remover.remove(record({ harness: 'dsh' }))).toEqual({ removed: true });
      expect(fs.existsSync(sessionDir)).toBe(false);
    } finally {
      await remover.dispose();
    }
  });

  test('an omp session has no second store to remove', async () => {
    const remover = createAgentSessionRemover({
      launch: () => Promise.reject(new Error('must not spawn')),
      storeDirs: async () => [],
    });
    try {
      expect(await remover.remove(record({ harness: 'omp-rpc' }))).toEqual({ removed: true });
      expect(await remover.remove(record({ harness: 'omp-acp' }))).toEqual({ removed: true });
    } finally {
      await remover.dispose();
    }
  });

  test('an id that is not one path segment is refused before any lookup', async () => {
    const remover = createAgentSessionRemover({
      launch: () => Promise.reject(new Error('must not spawn')),
      storeDirs: async () => {
        throw new Error('must not read a store');
      },
    });
    try {
      expect(await remover.remove(record({ agentSessionId: '../x' }))).toMatchObject({ removed: false });
    } finally {
      await remover.dispose();
    }
  });
});
