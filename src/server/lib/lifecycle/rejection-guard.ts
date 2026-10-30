/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Contain an unhandled promise rejection instead of letting it kill the server.
 *
 * Bun's default is to exit 1 on an unhandled rejection. For a CLI that is the
 * right answer; for this process it is not, because it hosts every live session
 * and every loaded plugin, and the rejections that actually arrive are from code
 * we do not own. Measured: the stats plugin's sampler re-reads its interval from
 * the database inside a floating `async` IIFE —
 *
 *     start() { (async () => { while (…) { … await readSampleMs() } })() }
 *
 * — so a data directory that vanished under it produced `SQLITE_IOERR_VNODE`
 * with no handler anywhere, and the whole server exited 1 while a browser was
 * mid-session. The plugin is a marketplace bundle; there is no line of it to fix,
 * and `service.start()` returning nothing means the loader cannot attach a
 * `.catch` either (its `void Promise.resolve(...).catch(...)` never sees this
 * rejection, because the promise it would catch is `undefined`).
 *
 * So the containment lives at the process boundary, and it REPORTS: the error
 * and its stack go to the log under the server's own prefix. That is the
 * difference between this and swallowing — a swallowed failure is one nobody can
 * find, and this one is one line away from the code that caused it.
 *
 * `uncaughtException` is deliberately NOT handled. A synchronous throw out of a
 * request handler leaves the process in an unknown state, and continuing from
 * there is how a server answers from half-applied writes; a rejection is a
 * promise nobody awaited, which leaves the process intact.
 */

/** The flag lives on `globalThis` because `bun --hot` re-evaluates this module. */
interface RejectionGuardHost {
  __kabmoRejectionGuard?: boolean;
}

const PREFIX = '[kabmo] unhandled rejection (contained)';

function guardHost(): RejectionGuardHost {
  return globalThis as RejectionGuardHost;
}

/** The message and stack of a rejection reason, whatever was thrown. */
export function describeRejection(reason: unknown): string {
  if (reason instanceof Error) return reason.stack ?? `${reason.name}: ${reason.message}`;
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason) ?? String(reason);
  } catch {
    // A rejected value with a circular reference must still produce a line.
    return String(reason);
  }
}

/**
 * Install the handler. Idempotent: the entry re-runs under `bun --hot` in the
 * same process, and a second listener would log every rejection twice.
 */
export function installRejectionGuard(): void {
  const host = guardHost();
  if (host.__kabmoRejectionGuard) return;
  host.__kabmoRejectionGuard = true;
  process.on('unhandledRejection', (reason) => {
    console.error(`${PREFIX}: ${describeRejection(reason)}`);
  });
}

/** Test seam: forget the installation so a spec can assert the listener. */
export function resetRejectionGuardForTests(): void {
  guardHost().__kabmoRejectionGuard = false;
}
