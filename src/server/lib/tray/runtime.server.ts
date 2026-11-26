/**
 * @license
 * SPDX-License-Identifier: MIT
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
 * Deliberately NOT a CLI subcommand. `kabmo tray run` spawned the host
 * detached and kept a pid file to find it again, which meant a `status`/`stop`
 * surface, a record to keep in sync, and a login entry that had to run the host
 * directly (launchd reaps a job's process tree). As a child of the server the
 * process tree IS the registration: no record, no pid to reap, and `serve
 * --tray` is the only thing that has to be true.
 */

import { getDataDir } from '@kabmo-labs/kabmo-paths/paths';
import { resolveBunBin } from '@/server/lib/lifecycle/bun';
import { packageDir } from '@/server/lib/fs/package-root';
import { getDb } from '@/server/db.server';
import { readAllSettingsJson } from '@kabmo-labs/kabmo-settings-store';
import { readSettingsBlob } from '@/shared/lib/settings/keys';
import { resolveTheme } from '@/shared/lib/theme/catalog';
import {
  resolveTrayIconStyle,
  TRAY_ICON_STYLE_SETTING_KEY,
  type TrayIconStyle,
} from '@/shared/lib/theme/tray-icon-style';
import { isAutostartInstalled } from '@/server/lib/tray/autostart';
import {
  buildTrayConfig,
  canonicalizeTrayPath,
  getTrayConfigPath,
  writeTrayConfig,
  type TrayConfig,
} from '@/server/lib/tray/config';
import { installHostScript, resolveHostScript } from '@/server/lib/tray/hosts';
import { childEnv } from '@kabmo-labs/kabmo-fs-child-env';

/** A live tray host: the child process and the config it was started with. */
interface TrayRuntime {
  child: Bun.Subprocess;
  config: TrayConfig;
}

/** The two facts the tray icon needs from the stored settings. */
export interface TrayAppearance {
  iconStyle: TrayIconStyle;
  /** Absolute path to the greyscale plate for the active theme's variant. */
  iconMono: string;
}

/**
 * Read the tray's appearance from `app_settings`.
 *
 * A failed read is the shipped default (colour, light glyph) rather than a
 * thrown error: the tray is a convenience over the console, and a database
 * hiccup must not stop the server from raising its icon.
 */
export async function readTrayAppearance(pkgRoot: string): Promise<TrayAppearance> {
  let settings: Record<string, unknown> = {};
  try {
    const db = await getDb();
    settings = await readAllSettingsJson(db);
  } catch {
    // Fall through to the defaults below.
  }
  const blob = readSettingsBlob(settings);
  const theme = typeof blob.theme === 'string' ? blob.theme : undefined;
  const variant = resolveTheme(theme).variant;
  return {
    iconStyle: resolveTrayIconStyle(blob[TRAY_ICON_STYLE_SETTING_KEY]),
    iconMono: canonicalizeTrayPath(`${packageDir(pkgRoot)}/public/tray-monochrome-${variant}.png`),
  };
}

/**
 * The running host, anchored on `globalThis` for the reason the database handle
 * is: `bun --hot` re-evaluates a changed module in place, so a module-level
 * binding would be reset while the child lived on — leaving a second tray icon
 * and no handle to the first.
 */
function slot(): { current: TrayRuntime | null } {
  const holder = globalThis as unknown as { __kabmoTray?: { current: TrayRuntime | null } };
  holder.__kabmoTray ??= { current: null };
  return holder.__kabmoTray;
}

/** Whether a tray host is running for this process. */
export function isTrayRunning(): boolean {
  return slot().current !== null;
}

/** Resolve every path a host needs and write the config document for `port`. */
export function writeTrayConfigFor({ port, host, tls, pkgRoot, appearance }: {
  port: number;
  host: string;
  tls: boolean;
  pkgRoot: string;
  appearance: TrayAppearance;
}): TrayConfig {
  const config = buildTrayConfig({
    pkgRoot,
    port,
    host,
    tls,
    dataDir: getDataDir(),
    bun: resolveBunBin(),
    icon: `${packageDir(pkgRoot)}/public/icon-192x192.png`,
    iconStyle: appearance.iconStyle,
    iconMono: appearance.iconMono,
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
export function ensureTray({ port, host, tls, pkgRoot, appearance, platform = process.platform }: {
  port: number;
  host: string;
  tls: boolean;
  pkgRoot: string;
  appearance: TrayAppearance;
  platform?: NodeJS.Platform;
}): { started: boolean; reason?: string } {
  if (isTrayRunning()) return { started: false, reason: 'already running' };

  const hostScript = resolveHostScript(platform);
  if (!hostScript.available()) return { started: false, reason: hostScript.unavailableReason };

  try {
    const config = writeTrayConfigFor({ port, host, tls, pkgRoot, appearance });
    installHostScript(platform);
    const child = Bun.spawn({
      cmd: hostScript.interpreter(getTrayConfigPath(port)),
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
      // The host shells back into the CLI; the credential is not its business.
      env: childEnv(),
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

/**
 * Re-apply the stored appearance to a RUNNING tray.
 *
 * The host is a separate process that reads its config once, so a settings edit
 * cannot reach it any other way. The old child is stopped and a new one started
 * with the same listener facts; when nothing moved this is a no-op, which is
 * what makes it safe to call after every settings write.
 */
export async function refreshTrayIcon({ pkgRoot }: { pkgRoot: string }): Promise<{ updated: boolean; reason?: string }> {
  const runtime = slot().current;
  if (!runtime) return { updated: false, reason: 'not running' };

  const appearance = await readTrayAppearance(pkgRoot);
  if (appearance.iconStyle === runtime.config.iconStyle && appearance.iconMono === runtime.config.iconMono) {
    return { updated: false, reason: 'unchanged' };
  }

  try {
    runtime.child.kill();
  } catch {
    // The host is already gone; starting the replacement is all that is left.
  }
  slot().current = null;
  const result = ensureTray({
    port: runtime.config.port,
    host: runtime.config.host,
    tls: runtime.config.tls,
    pkgRoot,
    appearance,
  });
  return { updated: result.started, reason: result.reason };
}
