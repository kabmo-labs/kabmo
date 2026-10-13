/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The tray icon, owned by the SERVER process (`serve --tray`).
 *
 * The host script is spawned as a plain CHILD of this process, and that is the
 * whole lifecycle: it exits when the server exits, because it watches its own
 * parent (`getppid`) and quits the moment that changes. Nothing else has to be
 * told — a server killed with SIGKILL, a `bun --hot` reload that re-executes
 * this module, or a crash all leave an orphaned child that notices on its next
 * tick. (Verified: with the parent gone the child's `getppid` becomes 1 and it
 * terminates itself.)
 *
 * The reverse direction is one signal: the menu's Quit sends SIGTERM to the
 * server, so the tray and the console it fronts end together. A tray that
 * outlived its server would be an icon for a port nobody serves.
 *
 * Deliberately NOT a CLI subcommand. `ompchamber tray run` spawned the host
 * detached and kept a pid file to find it again, which meant a `status`/`stop`
 * surface, a record to keep in sync, and a login entry that had to run the host
 * directly (launchd reaps a job's process tree). As a child of the server the
 * process tree IS the registration: no record, no pid to reap, and `serve
 * --tray` is the only thing that has to be true.
 */

import { getDataDir } from '@/server/lib/lifecycle/paths';
import { resolveBunBin } from '@/server/lib/lifecycle/bun';
import { packageDir } from '@/server/lib/fs/package-root';
import { isAutostartInstalled } from '@/server/lib/tray/autostart';
import {
  buildTrayConfig,
  getTrayConfigPath,
  writeTrayConfig,
  type TrayConfig,
} from '@/server/lib/tray/config';
import { installHostScript, resolveHostScript } from '@/server/lib/tray/hosts';

/** A live tray host: the child process and the config it was started with. */
interface TrayRuntime {
  child: Bun.Subprocess;
  config: TrayConfig;
}

/**
 * The running host, anchored on `globalThis` for the reason the database handle
 * is: `bun --hot` re-evaluates a changed module in place, so a module-level
 * binding would be reset while the child lived on — leaving a second tray icon
 * and no handle to the first.
 */
function slot(): { current: TrayRuntime | null } {
  const holder = globalThis as unknown as { __ompChamberTray?: { current: TrayRuntime | null } };
  holder.__ompChamberTray ??= { current: null };
  return holder.__ompChamberTray;
}

/** Whether a tray host is running for this process. */
export function isTrayRunning(): boolean {
  return slot().current !== null;
}

/** Resolve every path a host needs and write the config document for `port`. */
export function writeTrayConfigFor({ port, host, tls, pkgRoot }: {
  port: number;
  host: string;
  tls: boolean;
  pkgRoot: string;
}): TrayConfig {
  const config = buildTrayConfig({
    pkgRoot,
    port,
    host,
    tls,
    dataDir: getDataDir(),
    bun: resolveBunBin(),
    icon: `${packageDir(pkgRoot)}/public/icon-192x192.png`,
    pidFile: `${getDataDir()}/tray/host/tray-${port}.pid`,
    loginInstalled: isAutostartInstalled(),
  });
  writeTrayConfig(config);
  return config;
}

/**
 * Start the tray for a live server, once.
 *
 * Idempotent by the `globalThis` slot: a `bun --hot` reload re-runs the server
 * entry, and without this the reload would spawn a second icon beside the one
 * the first generation still holds.
 *
 * `stdout`/`stderr` are inherited so a host that cannot start (no tray client
 * on Linux, a JXA error) writes its reason into the server's own log instead of
 * vanishing. A host that starts successfully prints nothing.
 */
export function ensureTray({ port, host, tls, pkgRoot, platform = process.platform }: {
  port: number;
  host: string;
  tls: boolean;
  pkgRoot: string;
  platform?: NodeJS.Platform;
}): { started: boolean; reason?: string } {
  if (isTrayRunning()) return { started: false, reason: 'already running' };

  const hostScript = resolveHostScript(platform);
  if (!hostScript.available()) return { started: false, reason: hostScript.unavailableReason };

  try {
    const config = writeTrayConfigFor({ port, host, tls, pkgRoot });
    installHostScript(platform);
    const child = Bun.spawn({
      cmd: hostScript.interpreter(getTrayConfigPath(port)),
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const runtime: TrayRuntime = { child, config };
    slot().current = runtime;
    // The child exits when the SERVER does (it watches getppid), so this only
    // clears the in-process handle — it never has to kill anything.
    void child.exited.then(() => {
      if (slot().current === runtime) slot().current = null;
    });
    return { started: true };
  } catch (error) {
    return { started: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
