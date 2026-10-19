/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A destroy is the one place every teardown path meets — the Stop escalation
 * (`force_reset`), a rewind or delete that tears the child down before
 * rewriting the file, the timeout reset — so it is the one place that can
 * release the live `stream` row they all leave behind.
 *
 * Nothing else will. No `agent_end` arrives for a destroyed child, so the
 * terminal badge is never written, and the row's owner (THIS process) stays
 * alive, so neither half of the sidebar heal can reach it: the staleness half
 * sees a live pid and the orphan half only looks at rows the READER owns.
 * Measured on a real omp child: the row survived `force_reset` as `stream`, and
 * every other instance that opened the session drew a spinner and a generating
 * indicator for a run that was already over.
 *
 * The row writes resolve the database, so every case runs against a temp tree;
 * the real `~/.kabmo` is never opened.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDir } from '@/test-support/remove-dir';

import { AgentSessionWrapper } from '@/server/lib/omp/rpc/manager';
import type { RpcProcess } from '@/server/lib/omp/rpc/process';
import { loadStreamStates, markStreamStatus } from '@/shared/lib/omp/session/stream-state.server';

/** A process stub that only needs to survive `dispose()`. */
function makeProc(): RpcProcess {
  return {
    isAlive: true,
    pid: 4242,
    onFrame() {
      return () => {};
    },
    sendCommand() {
      return Promise.resolve(undefined);
    },
    sendFrame() {},
    async dispose() {},
  } as unknown as RpcProcess;
}

let root: string;
let savedDbPath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kabmo-destroy-'));
  savedDbPath = Bun.env.KABMO_DB_PATH;
  Bun.env.KABMO_DB_PATH = join(root, 'db.sqlite');
  delete globalThis.__kabmoDb;
});

afterEach(() => {
  // CLOSE the db handle before dropping it and deleting the tree, or Windows
  // fails the `rm` with EBUSY on the still-open connection.
  globalThis.__kabmoDb?.resolved?.raw.close();
  delete globalThis.__kabmoDb;
  if (savedDbPath === undefined) delete Bun.env.KABMO_DB_PATH;
  else Bun.env.KABMO_DB_PATH = savedDbPath;
  removeDir(root);
});

/** A wrapper with a live run and a matching `stream` row behind it. */
async function runningWrapper(sessionId: string): Promise<AgentSessionWrapper> {
  const wrapper = new AgentSessionWrapper(makeProc(), '/tmp');
  wrapper.start();
  // The id is getter-only; `adoptSessionIdentity` is how a real child sets it.
  wrapper.adoptSessionIdentity({ sessionId, sessionFile: '/tmp/s.jsonl' } as never);
  wrapper.streaming = true;
  await markStreamStatus(sessionId, 'stream', { provider: 'anthropic', modelId: 'claude' });
  return wrapper;
}

describe('destroy releases the run it was describing', () => {
  test('the Stop escalation (force_reset) releases the live row', async () => {
    const wrapper = await runningWrapper('sess-force-reset');
    expect((await loadStreamStates())['sess-force-reset']?.status).toBe('stream');

    // The release is awaited with the process teardown, so the row is already
    // gone when the destroy settles — no polling, no sleep.
    await wrapper.send({ type: 'force_reset' });

    expect((await loadStreamStates())['sess-force-reset']).toBeUndefined();
  });

  test('a bare destroy (rewind, delete, timeout reset) releases it too', async () => {
    const wrapper = await runningWrapper('sess-destroy');

    await wrapper.destroyAndWait();

    expect((await loadStreamStates())['sess-destroy']).toBeUndefined();
  });

  test('destroying an IDLE wrapper leaves the row alone', async () => {
    // The guard that keeps the release from deleting a row a fresh dispatch has
    // already written: an idle wrapper owns no run, so it must not touch one.
    const wrapper = new AgentSessionWrapper(makeProc(), '/tmp');
    wrapper.start();
    wrapper.adoptSessionIdentity({ sessionId: 'sess-idle', sessionFile: '/tmp/s.jsonl' } as never);
    await markStreamStatus('sess-idle', 'stream', { provider: 'anthropic', modelId: 'claude' });

    await wrapper.destroyAndWait();

    expect((await loadStreamStates())['sess-idle']?.status).toBe('stream');
  });
});
