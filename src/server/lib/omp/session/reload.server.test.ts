/**
 * @license
 * SPDX-License-Identifier: MIT
 *
 * The broadcast contract for a plugin/skill reload.
 *
 * Two properties are load-bearing and were both measured against omp 18.4.3:
 *
 * - **A BUSY session is reloaded too.** The previous version skipped
 *   `isBusy()` sessions on the theory that a prompt dispatched into a running
 *   turn is a queue insert. It is not: a `/reload-plugins` sent mid-turn is
 *   answered from omp's command loop in 16-40 ms with the turn still streaming
 *   (and with a blocking approval dialog parked), and the turn then completes
 *   normally. The guard therefore blocked the common case — the `create-skill`
 *   skill writes its SKILL.md with a tool WHILE the invoking chat streams.
 * - **Every live process is reached**, not just the session children: the
 *   pooled utility processes answer the composer's `/` popup, so a stale pool
 *   keeps offering the pre-change list after the sessions have refreshed.
 *
 * A burst of triggers coalesces onto one in-flight pass, or a catalog install
 * (many files) would broadcast a reload per event.
 */

import { describe, expect, test } from 'bun:test';
import { createReloader, type ReloadableSession } from '@/server/lib/omp/session/reload.server';

interface FakeSession extends ReloadableSession {
  reloads: number;
  fail: boolean;
}

function session(sessionId: string, options: { fail?: boolean } = {}): FakeSession {
  return {
    sessionId,
    fail: options.fail ?? false,
    reloads: 0,
    async reloadPlugins() {
      if (this.fail) throw new Error('session gone');
      this.reloads += 1;
      return true;
    },
  };
}

/** A reloader over `sessions`, counting utility-pool refreshes. */
function makeReloader(sessions: FakeSession[]) {
  const counts = { utility: 0 };
  const reloader = createReloader({
    sessions: () => sessions,
    reloadUtility: async () => {
      counts.utility += 1;
    },
  });
  return { reloader, counts };
}

describe('reloadLiveSessions', () => {
  test('reloads every live session, busy or idle', async () => {
    // The regression this pins: a BUSY session used to be skipped, and that is
    // exactly the session a mid-run skill write (the `create-skill` flow)
    // needs refreshed. The reloader no longer inspects session state at all.
    const sessions = [session('a'), session('b'), session('c')];
    const { reloader } = makeReloader(sessions);

    await reloader.reload();

    expect(sessions.map((entry) => entry.reloads)).toEqual([1, 1, 1]);
  });

  test('refreshes the pooled utility processes too', async () => {
    const { reloader, counts } = makeReloader([session('idle-1')]);

    await reloader.reload();

    expect(counts.utility).toBe(1);
  });

  test('a failing session does not stop the others', async () => {
    const sessions = [session('broken', { fail: true }), session('idle-1')];
    const { reloader } = makeReloader(sessions);

    await reloader.reload();

    expect(sessions[1]?.reloads).toBe(1);
  });

  test('a burst coalesces onto one in-flight pass', async () => {
    const sessions = [session('idle-1')];
    const { reloader } = makeReloader(sessions);

    const first = reloader.reload();
    const second = reloader.reload();

    // Same promise: a second caller joins the pass rather than broadcasting a
    // duplicate reload through every child.
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(sessions[0]?.reloads).toBe(1);

    // …and a later trigger still starts a fresh pass.
    await reloader.reload();
    expect(sessions[0]?.reloads).toBe(2);
  });

  test('no live sessions still refreshes the utility pool', async () => {
    const { reloader, counts } = makeReloader([]);

    expect(await reloader.reload()).toEqual([]);
    expect(counts.utility).toBe(1);
  });
});
