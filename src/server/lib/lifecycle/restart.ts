/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Replacing the instance that is serving an update request.
 *
 * A server cannot restart itself: the process holding the port has to exit
 * before a replacement can bind it, and the update response has to leave first.
 * So once the files on disk are replaced, the work goes to a detached
 * `ompchamber restart --port <port>` — the same stop-then-serve the CLI runs
 * after `ompchamber update`.
 *
 * Instances the CLI did not start are left alone. `bun run dev` and
 * `bun run start` execute this package's source in the user's own shell, and an
 * external supervisor (systemd, pm2, a container) owns the process it started;
 * all of them record `direct`, and replacing any of them would break a loop
 * OMPChamber does not own — or fight a second daemon for the port. Their own
 * launcher is what brings the new files up.
 */

import { existsSync } from 'node:fs';
import { join as joinPath } from 'node:path';

import { resolveBunBin } from '@/server/lib/lifecycle/bun';
import { packageDir } from '@/server/lib/fs/package-root';
import { listInstanceRecords } from '@/server/lib/lifecycle/instance';
import { isCliManaged, resolveLaunchMode, unmanagedReason } from '@/server/lib/lifecycle/launch-mode';
import { capitalizeFirstLetter } from '@/shared/lib/chat/capitalize';
import type { UpdateApplyResult } from '@/shared/types/updates';

/**
 * Package root of the running copy — the directory holding its `package.json`
 * and `src/cli/ompchamber.js`. Resolved by walking up from this module, never
 * by counting `..` segments: the AOT bundle flattens every server module into
 * `dist/client/index.js`, so a fixed depth names a different directory in a
 * published install than in a checkout.
 */
const PKG_ROOT = packageDir();

/**
 * Time between answering the update request and stopping the server. The
 * response is a small JSON body on a local listener; this is the margin that
 * keeps the console's toast from dying with the process that sent it.
 */
export const RESTART_GRACE_MS = 1_200;

export interface SelfRestartPlan {
  /** A detached restart is armed; `message` says so. */
  restarting: boolean;
  /** What to tell the user, either way. */
  message: string;
}

/**
 * Why the restart was asked for. The only difference is the wording: an update
 * restart tells the user to start the instance again "to apply the update",
 * while the console's own Restart button has no update to apply.
 */
export type SelfRestartPurpose = 'update' | 'restart';

/**
 * One-line reason an instance is left running, shared by the CLI and console.
 * The clause comes from `unmanagedReason` so `stop`, `restart` and `update`
 * cannot classify the same `launchMode` differently.
 */
export function skipRestartNote(
  launchMode: string | null | undefined,
  purpose: SelfRestartPurpose = 'update',
): string {
  const nextStep = purpose === 'restart'
    ? (launchMode === 'direct' ? 'start it again' : 'restart it yourself')
    : (launchMode === 'direct' ? 'start it again to apply the update' : 'restart it yourself to apply the update');
  return `this instance ${unmanagedReason(launchMode)} — ${nextStep}`;
}

/** The record this process wrote for itself; falls back to the env it was launched with. */
function ownInstance(): { port: number; launchMode: string } | null {
  const record = listInstanceRecords().find((entry) => entry.pid === process.pid);
  if (record) return { port: record.port, launchMode: record.launchMode };

  const port = Number(Bun.env.PORT);
  if (!Number.isFinite(port) || port <= 0) return null;
  return { port, launchMode: resolveLaunchMode() };
}

/** `ompchamber restart --port <port>` for the install this server runs from. */
function restartCommand(port: number): string[] | null {
  const cli = joinPath(PKG_ROOT, 'src', 'cli', 'ompchamber.js');
  if (!existsSync(cli)) return null;
  return [resolveBunBin(), cli, 'restart', '--port', String(port)];
}

/**
 * What the console is told when the restart is ARMED. Exported so the wording
 * is pinned by a test: it is the only thing telling the user the page will
 * reload itself, and the version it replaced said the console "reconnects on
 * its own" — which was true of the socket and false of the page.
 */
export function selfRestartMessage(port: number, purpose: SelfRestartPurpose = 'update'): string {
  const reason = purpose === 'restart' ? '' : ' to apply it';
  return `Restarting on port ${port}${reason} — this page reloads on its own.`;
}

/**
 * Folds a restart plan into the result the console reads.
 *
 * `restarting` and the sentence are one contract: the flag is what makes the
 * console wait for the replacement and reload, and the sentence is what tells
 * the user that is happening. Composed together so they cannot drift, and
 * capitalized here because it is appended after the update's own message, which
 * already ends in a period.
 */
export function withRestartPlan(result: UpdateApplyResult, plan: SelfRestartPlan): UpdateApplyResult {
  return {
    ...result,
    restarting: plan.restarting,
    message: `${result.message} ${capitalizeFirstLetter(plan.message)}`,
  };
}

/**
 * Stop and start this port again, once the response has been delivered. The
 * helper is detached so this process exiting does not take it down, and it
 * removes this port's record itself (`stopInstance`) before serving.
 */
export function scheduleSelfRestart(purpose: SelfRestartPurpose = 'update'): SelfRestartPlan {
  const self = ownInstance();
  if (!self) {
    const nextStep = purpose === 'restart' ? 'restart it yourself' : 'restart it yourself to apply the update';
    return { restarting: false, message: `This instance could not be identified — ${nextStep}.` };
  }

  if (!isCliManaged(self.launchMode)) {
    return { restarting: false, message: skipRestartNote(self.launchMode, purpose) };
  }

  const cmd = restartCommand(self.port);
  if (!cmd) {
    const nextStep = purpose === 'restart' ? 'restart it yourself' : 'restart it yourself to apply the update';
    return { restarting: false, message: `The ompchamber CLI is missing from ${PKG_ROOT} — ${nextStep}.` };
  }

  setTimeout(() => {
    console.log(`[ompchamber] restarting on port ${self.port}: ${cmd.join(' ')}`);
    try {
      Bun.spawn({ cmd, cwd: PKG_ROOT, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit', detached: true }).unref();
    } catch (err) {
      console.error(`[ompchamber] restart helper could not be started: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, RESTART_GRACE_MS);

  return { restarting: true, message: selfRestartMessage(self.port, purpose) };
}
