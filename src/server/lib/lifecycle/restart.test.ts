/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Restart decisions, the listener reference, and applying an update.
 *
 * `restart.ts` decides whether the update flow may replace the running process.
 * Getting it wrong is asymmetric: replacing a `bun run dev` server ends a loop
 * Kabmo does not own, while refusing to replace a daemon leaves the old
 * build serving. The decision is pinned through the two sources it reads — the
 * instance record and `PORT` — with the detached-spawn branch deliberately not
 * exercised (arming it would launch a real `ompchamber restart`).
 *
 * `apply.ts` turns one update run into `{ result, updated }`. `updated: false`
 * for the "already up to date" phrase is load-bearing: it is a SUCCESS that must
 * not bounce a healthy server, so it is pinned with a fixture `omp` binary
 * (never the real binary, never the network). The concurrency refusal is pinned
 * too, because a second run replacing the same install in place is the failure
 * the slot exists to prevent.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { executableStub } from '@/test-support/executable-stub';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { RESTART_GRACE_MS, scheduleSelfRestart, selfRestartMessage, skipRestartNote, withRestartPlan } from '@/server/lib/lifecycle/restart';
import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import { clearListener, listenerFetchOptions, listenerUrl, setListener } from '@/server/lib/lifecycle/listener';
import { resolveBunBin } from '@/server/lib/lifecycle/bun';
import { SHELL_ROUTE } from '@/server/lib/lifecycle/shell-route';
import { writeInstanceRecord } from '@/server/lib/lifecycle/instance';
import { applyUpdate } from '@/server/lib/updates/apply';
import { UpdateInProgressError } from '@/server/lib/updates/single-flight';
import { isManualMethod, REPO_URL } from '@/server/lib/updates/install-method';
import { checkAllUpdates, MOCK_CURRENT_VERSION, MOCK_LATEST_VERSION } from '@/server/lib/updates/check';
import type { UpdateApplyResult, UpdateTarget } from '@/shared/types/updates';

const originalDataDir = Bun.env.OMPCHAMBER_DATA_DIR;
const originalOmpBin = Bun.env.OMPCHAMBER_OMP_BIN;
const originalPort = Bun.env.PORT;
const fixtures: string[] = [];

function useDataDir(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ompchamber-restart-test-'));
  fixtures.push(dir);
  Bun.env.OMPCHAMBER_DATA_DIR = dir;
}

/** A stand-in for the `omp` binary; the real one is never spawned. The answer is
 * read from the environment, which `applyOmpUpdate` passes to the child. */
const RESTART_OMP_SOURCE = `const output = process.env.FAKE_OMP_OUTPUT || '';
const exit = Number(process.env.FAKE_OMP_EXIT || '0');
if (output) process.stdout.write(output + '\\n');
process.exit(exit);
`;

let restartOmpBin = '';

async function useFixtureOmp(output: string, exitCode = 0): Promise<void> {
  if (!restartOmpBin) restartOmpBin = await executableStub(RESTART_OMP_SOURCE, 'fake-omp-restart');
  Bun.env.OMPCHAMBER_OMP_BIN = restartOmpBin;
  Bun.env.FAKE_OMP_OUTPUT = output;
  Bun.env.FAKE_OMP_EXIT = String(exitCode);
  invalidateOmpCliCache();
}

afterEach(() => {
  if (originalDataDir === undefined) delete Bun.env.OMPCHAMBER_DATA_DIR;
  else Bun.env.OMPCHAMBER_DATA_DIR = originalDataDir;
  if (originalOmpBin === undefined) delete Bun.env.OMPCHAMBER_OMP_BIN;
  else Bun.env.OMPCHAMBER_OMP_BIN = originalOmpBin;
  invalidateOmpCliCache();
  if (originalPort === undefined) delete Bun.env.PORT;
  else Bun.env.PORT = originalPort;
  delete Bun.env.FAKE_OMP_OUTPUT;
  delete Bun.env.FAKE_OMP_EXIT;
  for (const dir of fixtures.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('skipRestartNote', () => {
  test('tells a source run to start itself again', () => {
    expect(skipRestartNote('direct')).toBe(
      'this instance runs from source (`bun run dev` / `bun run start`) — start it again to apply the update',
    );
  });

  test('tells every other unmanaged instance to restart itself', () => {
    const expected = 'this instance is not managed by the ompchamber CLI — restart it yourself to apply the update';
    expect(skipRestartNote('daemon')).toBe(expected);
    expect(skipRestartNote(null)).toBe(expected);
    expect(skipRestartNote(undefined)).toBe(expected);
  });

  test('the grace period is the documented 1200 ms', () => {
    expect(RESTART_GRACE_MS).toBe(1200);
  });

  test('the armed restart says the PAGE reloads, not that the console reconnects', () => {
    // The page waits for the replacement and reloads itself (`useUpdates`), so
    // a message about a reconnecting socket would describe the wrong thing.
    expect(selfRestartMessage(4242)).toBe('Restarting on port 4242 to apply it — this page reloads on its own.');
  });

  test('the console Restart button has nothing to "apply", so its wording drops that clause', () => {
    // Both messages come from one function so they cannot drift, but a restart
    // that is not an update must not claim it is applying one.
    expect(selfRestartMessage(4242, 'restart')).toBe('Restarting on port 4242 — this page reloads on its own.');
    expect(skipRestartNote('direct', 'restart')).toBe(
      'this instance runs from source (`bun run dev` / `bun run start`) — start it again',
    );
    expect(skipRestartNote('daemon', 'restart')).toBe(
      'this instance is not managed by the ompchamber CLI — restart it yourself',
    );
  });
});

describe('withRestartPlan', () => {
  const updated: UpdateApplyResult = { success: true, target: 'ompchamber', manual: false, message: 'Kabmo updated to v2.0.0 (bun-global).' };

  test('an armed plan sets the flag and appends the sentence', () => {
    const result = withRestartPlan(updated, { restarting: true, message: selfRestartMessage(3000) });
    expect(result.restarting).toBe(true);
    expect(result.message).toBe(
      'Kabmo updated to v2.0.0 (bun-global). Restarting on port 3000 to apply it — this page reloads on its own.',
    );
  });

  test('an unmanaged instance reports the flag as false with the reason appended', () => {
    // The console must not wait for a replacement that was never armed, and the
    // sentence is the only place the user learns why.
    const result = withRestartPlan(updated, { restarting: false, message: skipRestartNote('direct') });
    expect(result.restarting).toBe(false);
    expect(result.message).toContain('runs from source');
  });
});

describe('scheduleSelfRestart', () => {
  test('refuses when the instance cannot be identified', () => {
    // No record for this PID and no PORT to fall back to: guessing a port would
    // stop a server that is not this one.
    useDataDir();
    delete Bun.env.PORT;
    const plan = scheduleSelfRestart();
    expect(plan.restarting).toBe(false);
    expect(plan.message).toContain('could not be identified');
  });

  test('leaves a direct instance alone, using the record it wrote for itself', () => {
    // `bun run dev` records `direct`; an update must not bounce the user's loop.
    useDataDir();
    writeInstanceRecord({
      pid: process.pid,
      port: 4201,
      host: 'localhost',
      mode: 'dev',
      launchMode: 'direct',
      tray: false,
      tls: false,
      auth: false,
      startedAt: '2026-10-01T10:00:00.000Z',
      version: '0.5.0',
    });
    const plan = scheduleSelfRestart();
    expect(plan.restarting).toBe(false);
    expect(plan.message).toBe(skipRestartNote('direct'));
  });

  test('the console Restart button refuses a direct instance with the restart wording', () => {
    // Same decision, different reason: there is no update to apply, so the
    // sentence must not tell the user to start again "to apply the update".
    useDataDir();
    writeInstanceRecord({
      pid: process.pid,
      port: 4203,
      host: 'localhost',
      mode: 'dev',
      launchMode: 'direct',
      tray: false,
      tls: false,
      auth: false,
      startedAt: '2026-10-01T10:00:00.000Z',
      version: '0.5.0',
    });
    const plan = scheduleSelfRestart('restart');
    expect(plan.restarting).toBe(false);
    expect(plan.message).toBe(skipRestartNote('direct', 'restart'));
    expect(plan.message).not.toContain('apply the update');
  });

  test('falls back to the launch mode in argv when there is no record', () => {
    useDataDir();
    Bun.env.PORT = '4202';
    // `bun test` carries no `--launch-mode=` flag, so this resolves to `direct`
    // — still not CLI-managed, so still no restart.
    const plan = scheduleSelfRestart();
    expect(plan.restarting).toBe(false);
    expect(plan.message).toBe(skipRestartNote('direct'));
  });
});

describe('listener reference', () => {
  // The reference is module state shared by the whole `bun test` process, so
  // each case starts and ends with it unpublished.
  beforeEach(clearListener);
  afterEach(clearListener);

  test('is empty before the server publishes its listener', () => {
    expect(listenerUrl()).toBeNull();
    expect(listenerFetchOptions()).toEqual({});
  });

  test('publishes the URL and the fetch options together', () => {
    // Under TLS the two are only correct together: the URL is https with a
    // self-signed certificate, so a request without the options fails.
    const url = new URL('https://127.0.0.1:4203/');
    const options = { tls: { rejectUnauthorized: false } } as RequestInit;
    setListener({ url }, options);
    expect(listenerUrl()).toBe(url);
    expect(listenerFetchOptions()).toBe(options);
  });

  test('defaults the fetch options to an empty object', () => {
    setListener({ url: new URL('http://127.0.0.1:4204/') });
    expect(listenerFetchOptions()).toEqual({});
  });
});

describe('bun binary and shell route', () => {
  test('prefers the runtime this install was started with', () => {
    // The test process IS Bun, so `process.execPath` is the answer, and it must
    // be an existing absolute path rather than a PATH guess.
    expect(resolveBunBin()).toBe(process.execPath);
    expect(fs.existsSync(resolveBunBin())).toBe(true);
  });

  test('the shell route is the underscored constant both ends share', () => {
    // A rename on one side alone would 404 the shell route and answer 503.
    expect(SHELL_ROUTE).toBe('/_shell');
  });
});

describe('install-method helpers', () => {
  test('names the repository the only fast-forwardable checkout tracks', () => {
    expect(REPO_URL).toBe('https://github.com/kabmo-labs/kabmo.git');
  });

  test('classifies only npm and unmanaged copies as manual', () => {
    expect(isManualMethod('npm')).toBe(true);
    expect(isManualMethod('unmanaged')).toBe(true);
    expect(isManualMethod('git')).toBe(false);
    expect(isManualMethod('bun-global')).toBe(false);
  });
});

describe('checkAllUpdates', () => {
  const originalMock = Bun.env.MOCK;

  afterEach(() => {
    if (originalMock === undefined) delete Bun.env.MOCK;
    else Bun.env.MOCK = originalMock;
  });

  test('MOCK mode answers a fixed pair without probing anything', async () => {
    // The demo range is what makes the update UI reachable on a dev checkout,
    // whose real version is usually already the newest release.
    Bun.env.MOCK = 'true';
    const result = await checkAllUpdates();
    expect(result.ompchamber).toEqual({
      current: MOCK_CURRENT_VERSION,
      latest: MOCK_LATEST_VERSION,
      updateAvailable: true,
      installed: true,
      error: null,
      releaseName: `v${MOCK_LATEST_VERSION}`,
      releaseUrl: `https://github.com/kabmo-labs/kabmo/releases/tag/v${MOCK_LATEST_VERSION}`,
    });
    expect(result.omp).toEqual({ current: '18.3.0', latest: '18.4.0', updateAvailable: true, installed: true, error: null });
    expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false);
  });
});

describe('applyUpdate', () => {
  test('an unknown target is a manual failure that changed nothing', async () => {
    const applied = await applyUpdate('sideways' as UpdateTarget);
    if (applied.updated !== false) throw new Error('expected updated === false');
    expect((applied as { result: unknown }).result).toEqual({
      success: false,
      target: 'sideways',
      manual: true,
      message: 'Unknown update target',
    });
  });

  test('the already-current phrase is a success with updated: false', async () => {
    // Nothing on disk moved, so the caller must not restart the server.
    await useFixtureOmp('Already up to date');
    const applied = await applyUpdate('omp');
    if (applied.updated !== false) throw new Error('expected updated === false');
    expect(applied.result.success).toBe(true);
    expect(applied.result.message).toBe('oh-my-pi is already up to date');
  });

  test('a moved install reports updated: true', async () => {
    await useFixtureOmp('Switching to omp 18.4.0');
    const applied = await applyUpdate('omp');
    expect(applied.updated).toBe(true);
    expect(applied.result.message).toBe('oh-my-pi updated');
  });

  test('a missing omp binary fails without moving anything', async () => {
    Bun.env.OMPCHAMBER_OMP_BIN = path.join(os.tmpdir(), 'ompchamber-definitely-absent', 'omp');
    const applied = await applyUpdate('omp');
    if (applied.updated !== false) throw new Error('expected updated === false');
    expect(applied.result.success).toBe(false);
    expect(applied.result.message).toBe('omp binary not found');
  });

  test('a second run in the same tick is refused, not queued', async () => {
    // Two runs would replace the same install in place; the claim is taken
    // synchronously so the console cannot start both.
    const first = applyUpdate('sideways' as UpdateTarget);
    await expect(applyUpdate('sideways' as UpdateTarget)).rejects.toBeInstanceOf(UpdateInProgressError);
    await first;
    // The slot is released, so the next run is accepted again.
    expect((await applyUpdate('sideways' as UpdateTarget)).updated).toBe(false);
  });
});
