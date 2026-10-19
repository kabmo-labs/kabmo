/**
 * One update at a time, for the whole server.
 *
 * An update is long and it replaces an install in place, so overlapping runs
 * are not merely wasteful: two `updateKabmo` calls mean two
 * `git merge --ff-only` plus two `bun install` in the same checkout, and two
 * `omp update` calls race over the same binary.
 *
 * The console cannot be the gate. Its "a run is in flight" state is JavaScript,
 * so a page reload forgets it and offers the button again while the first run
 * is still going — measured: a reload mid-run followed by one more click left
 * two `omp update` children alive at once.
 *
 * The claim is taken SYNCHRONOUSLY, before the run's first `await`, so two
 * requests arriving in the same tick cannot both pass. Release is bound to the
 * token `beginUpdate` issues rather than to the target name, so a stale release
 * cannot free a claim belonging to a different run.
 */

import type { UpdateTarget } from '@/shared/types/updates';

/** What the console is told when a second run is refused. */
export function updateBusyMessage(target: UpdateTarget): string {
  return `An ${target === 'omp' ? 'Oh-My-Pi' : 'Kabmo'} update is already running.`;
}

export class UpdateInProgressError extends Error {
  constructor(target: UpdateTarget) {
    super(updateBusyMessage(target));
    this.name = 'UpdateInProgressError';
  }
}

let held: { token: symbol; target: UpdateTarget } | null = null;

/** The target of the update in flight, or null when none is. */
export function runningUpdate(): UpdateTarget | null {
  return held?.target ?? null;
}

/** Take the slot. Throws when another run already holds it. */
function beginUpdate(target: UpdateTarget): symbol {
  if (held) throw new UpdateInProgressError(held.target);
  const token = Symbol('update');
  held = { token, target };
  return token;
}

/** Release the slot; a token that no longer owns it is ignored. */
function releaseUpdate(token: symbol): void {
  if (held?.token === token) held = null;
}

/**
 * Run `run` while holding the slot.
 *
 * The release is in a `finally`, so a failed update cannot leave the server
 * answering "already running" forever — there is no other way to clear the
 * flag, and a stuck flag would need a restart.
 */
export async function withUpdateSlot<T>(target: UpdateTarget, run: () => Promise<T>): Promise<T> {
  const token = beginUpdate(target);
  try {
    return await run();
  } finally {
    releaseUpdate(token);
  }
}
