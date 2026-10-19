/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The staleness rule behind the sidebar's self-heal. Getting it wrong is
 * user-visible in both directions: too eager clears the spinner of a run that
 * is still working, too lazy leaves a spinner turning forever for a run whose
 * process is gone.
 *
 * The rule is deliberately a pure function of the ROW plus OS liveness, with no
 * caller context. That is what makes several Kabmo instances agree: they all
 * read the same row and ask the same question about the same pid.
 */

import { describe, expect, test } from 'bun:test';

import { isOrphanStreamRow, isStaleStreamRow } from '@/shared/lib/omp/session/stream-heal.server';

const OWNER = 4242;
const otherInstance = 9999;
/** OWNER and the other instance are alive; anything else, including 999999, is not. */
const alive = (pid: number) => pid === OWNER || pid === otherInstance;
/** Both live owners still run a Kabmo command line. */
const ours = () => 'matched' as const;

describe('isStaleStreamRow', () => {
  test('a row whose owner is alive is live, whoever is asking', () => {
    expect(isStaleStreamRow({ session_id: 's1', owner_pid: OWNER }, alive, ours)).toBe(false);
  });

  test('a row whose owner is gone is stale', () => {
    expect(isStaleStreamRow({ session_id: 's1', owner_pid: 999999 }, alive, ours)).toBe(true);
  });

  test('the verdict does not depend on which instance is asking', () => {
    // The regression this shape exists for: several instances read ONE row and
    // must report the same status. Judging by the reader's own runtime registry
    // made a second instance call another instance's live run stale — the row
    // is live here, and every asker must say so.
    const row = { session_id: 's1', owner_pid: otherInstance };
    const verdicts = [otherInstance, OWNER, 12345].map(() => isStaleStreamRow(row, alive, ours));
    expect(verdicts).toEqual([false, false, false]);
  });

  test('an ownerless row is stale, because nothing can vouch for its run', () => {
    expect(isStaleStreamRow({ session_id: 's1', owner_pid: null }, alive, ours)).toBe(true);
  });

  test('a row owned by the reader is judged by liveness like any other', () => {
    // Self-ownership is not special-cased: the reader's own pid is alive while
    // it runs, so its live rows survive.
    expect(isStaleStreamRow({ session_id: 's1', owner_pid: OWNER }, (pid) => pid === OWNER, ours)).toBe(false);
  });

  test('a RECYCLED owner pid is stale: liveness alone is not identity', () => {
    // The owner exited and the OS handed its pid to an unrelated process. The
    // pid answers `kill(pid, 0)`, so a liveness-only rule reports "live"
    // forever: the run is gone, no terminal status will ever be written, and
    // no other instance can heal the row. Identity comes from the command line.
    const row = { session_id: 's1', owner_pid: OWNER };
    expect(isStaleStreamRow(row, alive, () => 'mismatched')).toBe(true);
  });

  test('an unreadable owner identity keeps the previous bias and stays live', () => {
    // A host whose probe cannot answer must not make a live instance look dead.
    expect(isStaleStreamRow({ session_id: 's1', owner_pid: OWNER }, alive, () => 'unknown')).toBe(false);
  });
});

/**
 * The other half of the heal, and the one the staleness rule structurally
 * cannot cover: a row this process owns while holding no live run for it.
 *
 * The shipped defect was exactly this shape — a dispatch wrote `stream`, omp
 * accepted the prompt and opened no turn, and no frame ever settled it. The
 * owner is ALIVE, so `isStaleStreamRow` says "live" and the row is
 * unreleasable; the sidebar spinner turns until the process restarts.
 */
describe('isOrphanStreamRow', () => {
  const ME = 4242;
  const running = new Set(['live-session']);

  test('releases a row this process owns with no live run behind it', () => {
    expect(isOrphanStreamRow({ session_id: 'orphan', owner_pid: ME }, ME, running)).toBe(true);
  });

  test('keeps the row of a session this process is actually running', () => {
    expect(isOrphanStreamRow({ session_id: 'live-session', owner_pid: ME }, ME, running)).toBe(false);
  });

  test('never touches another process’s row', () => {
    // That instance answers for its own runs; judging its rows from here is
    // exactly the cross-instance disagreement the owner-pid rule exists to
    // prevent.
    expect(isOrphanStreamRow({ session_id: 'theirs', owner_pid: 9999 }, ME, running)).toBe(false);
  });

  test('an omitted live-run set releases nothing', () => {
    // A caller that cannot answer "what am I running?" must never guess.
    expect(isOrphanStreamRow({ session_id: 'orphan', owner_pid: ME }, ME, undefined)).toBe(false);
  });

  test('an EMPTY live-run set releases every row this process owns', () => {
    // The honest reading of "I run nothing": this is what lets a restarted
    // process clear the rows its predecessor left behind.
    expect(isOrphanStreamRow({ session_id: 'orphan', owner_pid: ME }, ME, new Set())).toBe(true);
  });

  test('a row with no owner is the staleness rule’s business, not this one', () => {
    expect(isOrphanStreamRow({ session_id: 's1', owner_pid: null }, ME, running)).toBe(false);
    // ...and that rule does release it.
    expect(isStaleStreamRow({ session_id: 's1', owner_pid: null }, () => true)).toBe(true);
  });
});

/**
 * The run model rides the same row as the status, and the whole point of the
 * column pair is that a status flip cannot blank it: `agent_start`, the terminal
 * badge and the heal pass all re-mark the row with no model, and the COALESCE in
 * the upsert is what keeps the pair the indicator reads.
 */
