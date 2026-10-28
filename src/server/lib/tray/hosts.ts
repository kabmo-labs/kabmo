/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which host script draws the tray on this platform, and how it is started.
 *
 * The choice is by `process.platform` at the call site, exactly as the process
 * probe chooses its backend — no caller knows which one it got.
 *
 * The script is COPIED into the data directory before it runs. A login entry
 * outlives the install that wrote it (an `kabmo update` replaces the
 * package tree, a checkout moves), so the path baked into a LaunchAgent, a
 * `.desktop` file or a Run key has to be one only the data directory owns.
 * `source` is inside the package and `target` inside the data directory, joined
 * here so a caller cannot copy one platform's script under another's name.
 */

import fs from 'node:fs';

import { packageDir } from '@/server/lib/fs/package-root';
import { getTrayHostDir } from '@/server/lib/tray/config';

export interface HostScript {
  /** Absolute path to the shipped host inside the package. */
  source: string;
  /** Absolute path inside the data directory, refreshed on every start. */
  target: string;
  /** argv that runs `target` with a config path. */
  interpreter: (configPath: string) => string[];
  /** Whether the interpreter this host needs is on PATH. */
  available: () => boolean;
  /** Why it is unavailable, for the log line when it is. */
  unavailableReason: string;
}

/**
 * The directory holding the host scripts in this install.
 *
 * `packageDir()`, never `import.meta.dir`: the production bundle flattens every
 * server module into `dist/client/index.js`, so `import.meta.dir` is
 * `dist/client` and the host sources are not beside it. Measured: the bundled
 * server logged `icon shown` and then `osascript: …/darwin.js: No such file or
 * directory`, because the path it computed did not exist.
 */
function hostSourceDir(): string {
  return `${packageDir()}/src/server/lib/tray/host`;
}

export function resolveHostScript(platform: NodeJS.Platform = process.platform): HostScript {
  const dir = getTrayHostDir();
  const source = hostSourceDir();

  if (platform === 'darwin') {
    return {
      source: `${source}/darwin.js`,
      target: `${dir}/darwin.js`,
      // `-l JavaScript` is not optional: osascript defaults to AppleScript, and
      // this file is JXA.
      interpreter: (configPath) => ['osascript', '-l', 'JavaScript', `${dir}/darwin.js`, configPath],
      available: () => Bun.which('osascript') !== null,
      unavailableReason: 'The macOS tray needs `osascript`, which is part of macOS.',
    };
  }

  if (platform === 'win32') {
    return {
      source: `${source}/win32.ps1`,
      target: `${dir}/win32.ps1`,
      interpreter: (configPath) => [
        'powershell',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        `${dir}/win32.ps1`,
        '-ConfigPath',
        configPath,
      ],
      available: () => Bun.which('powershell') !== null || Bun.which('pwsh') !== null,
      unavailableReason: 'The Windows tray needs PowerShell (`powershell` or `pwsh`) on PATH.',
    };
  }

  return {
    source: `${source}/linux.js`,
    target: `${dir}/linux.js`,
    // Bun runs the .js host directly — the runtime the server already requires.
    interpreter: (configPath) => [process.execPath, `${dir}/linux.js`, configPath],
    available: () => true,
    // The Linux host's own check is which tray CLIENT exists (yad/zenity), which
    // is a per-run question rather than a PATH question about the interpreter.
    unavailableReason: 'The Linux tray needs `yad` or `zenity`.',
  };
}

/**
 * Copy this build's host script into the data directory, returning its target.
 *
 * Copied rather than run from the package because a login entry outlives the
 * install that wrote it: an `kabmo update` replaces the package tree, so
 * the path a LaunchAgent, a `.desktop` file or a Run key names has to be one
 * only the data directory owns.
 */
export function installHostScript(platform: NodeJS.Platform = process.platform): { target: string } {
  const host = resolveHostScript(platform);
  if (!fs.existsSync(host.source)) {
    throw new Error(`This install has no tray host for ${platform} (expected ${host.source}).`);
  }
  fs.mkdirSync(getTrayHostDir(), { recursive: true });
  fs.copyFileSync(host.source, host.target);
  fs.chmodSync(host.target, 0o644);
  return { target: host.target };
}
