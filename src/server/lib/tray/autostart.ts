/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Registering Kabmo to start at login — `serve --startup`.
 *
 * Three platforms, three mechanisms, and each is the one the OS itself reads:
 *
 *   macOS    `~/Library/LaunchAgents/<label>.plist`, loaded with `launchctl
 *            bootstrap gui/<uid>`.
 *   Linux    `$XDG_CONFIG_HOME/autostart/*.desktop`, which every freedesktop
 *            session reads; nothing has to be "loaded", the file IS the
 *            registration.
 *   Windows  the HKCU `...\CurrentVersion\Run` value, written with `reg add` —
 *            HKCU rather than HKLM so registering never needs elevation.
 *
 * **The entry runs the SERVER, not the CLI.** launchd reaps a job's whole
 * process tree when the job's program exits, so an entry that ran the CLI
 * spawned the server and then lost it — verified: the log recorded a successful
 * start while `launchctl print` showed `state = not running`. The server also
 * writes its own instance record, which is the same rule: the process that owns
 * a record writes it.
 *
 * The argv is built by the CALLER (the `serve` command) and stored verbatim, so
 * what starts at login is the same invocation that registered it — same port,
 * same host, same `--tray` choice, same password source. Only the mode is pinned
 * to `--prod`: a login entry has no shell to export `NODE_ENV`.
 */

import fs from 'node:fs';
import os from 'node:os';

/** launchd label (also the plist file name). */
export const AUTOSTART_LABEL = 'dev.kabmo.tray';

/** `HKCU\...\Run` value name on Windows. */
export const WINDOWS_RUN_VALUE = 'KabmoTray';

/** Basename of the Linux XDG autostart entry. */
export const LINUX_DESKTOP_FILE = 'kabmo-tray.desktop';

/**
 * The pre-rename spellings, removed on sight.
 *
 * A login entry is a file the OS executes at every boot, and the one written
 * before the rename runs `src/cli/ompchamber.js` — a file this release does not
 * ship. Leaving it in place means a failed launch on every login with nothing on
 * screen to explain it, and no command that could repair it: `--no-startup`
 * removes the CURRENT entry, not that one. Removing it is safe in the only
 * sense that matters — it cannot work any more — and a user who wants the
 * server at login registers it again with `serve --startup`, which writes the
 * new entry.
 */
export const LEGACY_AUTOSTART_LABEL = 'dev.ompchamber.tray';
export const LEGACY_LINUX_DESKTOP_FILE = 'ompchamber-tray.desktop';

/** `$XDG_CONFIG_HOME`, or `~/.config`. */
function xdgConfigHome(): string {
  const override = (Bun.env.XDG_CONFIG_HOME ?? '').trim();
  return override.length > 0 ? override : `${os.homedir()}/.config`;
}

/** Where this platform's login entry lives (null on Windows: a registry value). */
export function getAutostartEntryPath(platform: NodeJS.Platform = process.platform): string | null {
  if (platform === 'darwin') return `${os.homedir()}/Library/LaunchAgents/${AUTOSTART_LABEL}.plist`;
  if (platform === 'linux') return `${xdgConfigHome()}/autostart/${LINUX_DESKTOP_FILE}`;
  return null;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function desktopQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')}"`;
}

/**
 * The launchd plist for `argv`.
 *
 * `KeepAlive` is deliberately absent: launchd would restart a server the user
 * stopped on purpose, which is the one action that has to stick. `RunAtLoad` is
 * what starts it at login, and it is the only lifecycle claim made here.
 */
export function renderLaunchAgent({ argv, logFile }: { argv: string[]; logFile: string }): string {
  const args = argv.map((value) => `    <string>${xmlEscape(value)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(AUTOSTART_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logFile)}</string>
</dict>
</plist>
`;
}

/** The XDG autostart entry for `argv`. */
export function renderDesktopEntry({ argv, port }: { argv: string[]; port: number }): string {
  const command = argv.map(desktopQuote).join(' ');
  return `[Desktop Entry]
Type=Application
Version=1.0
Name=Kabmo
Comment=Kabmo console and tray on port ${port}
Exec=${command}
Terminal=false
X-GNOME-Autostart-enabled=true
StartupNotify=false
`;
}

/** The command line a Windows `Run` value stores. */
export function renderWindowsRunValue(argv: string[]): string {
  return argv.map((value) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value)).join(' ');
}

/**
 * Write this platform's login entry. Returns where it went.
 *
 * Throws with the platform's own reason when the write fails — a login entry the
 * user asked for and did not get must not report success.
 */
export function installAutostart({
  argv,
  port,
  logFile,
  platform = process.platform,
}: {
  argv: string[];
  port: number;
  logFile: string;
  platform?: NodeJS.Platform;
}): { path?: string; registry?: boolean; argv: string[] } {
  if (platform === 'win32') {
    const value = renderWindowsRunValue(argv);
    const result = Bun.spawnSync({
      cmd: [
        'reg', 'add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
        '/v', WINDOWS_RUN_VALUE, '/t', 'REG_SZ', '/d', value, '/f',
      ],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode !== 0) {
      throw new Error(`reg add failed: ${(result.stderr?.toString() ?? '').trim() || `exit ${result.exitCode}`}`);
    }
    return { registry: true, argv };
  }

  const target = getAutostartEntryPath(platform);
  if (!target) throw new Error(`Autostart is not supported on ${platform}.`);

  const content = platform === 'darwin'
    ? renderLaunchAgent({ argv, logFile })
    : renderDesktopEntry({ argv, port });

  // `dirname` semantics from the string, not `join(target, '..')`: that join
  // does not collapse the `..` (it strips a leading slash and rejoins), so it
  // created a DIRECTORY named after the plist and the write failed with EISDIR —
  // measured with HOME redirected at a temp dir.
  const dir = target.slice(0, target.lastIndexOf('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(target, content, { mode: 0o644 });
  return { path: target, argv };
}

/** Remove this platform's login entry. True when one was removed. */
export function uninstallAutostart({ platform = process.platform } = {}): boolean {
  if (platform === 'win32') {
    const result = Bun.spawnSync({
      cmd: [
        'reg', 'delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
        '/v', WINDOWS_RUN_VALUE, '/f',
      ],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return result.exitCode === 0;
  }

  const target = getAutostartEntryPath(platform);
  if (!target || !fs.existsSync(target)) return false;
  fs.rmSync(target, { force: true });
  return true;
}

/**
 * Remove a login entry written before the rename. Returns where one was removed.
 *
 * Windows needs nothing: the Run value has always been `KabmoTray`, so the
 * registration was renamed with the product rather than by it.
 */
export function removeLegacyAutostart({ platform = process.platform } = {}): string | null {
  if (platform === 'win32') return null;
  const target = platform === 'darwin'
    ? `${os.homedir()}/Library/LaunchAgents/${LEGACY_AUTOSTART_LABEL}.plist`
    : `${xdgConfigHome()}/autostart/${LEGACY_LINUX_DESKTOP_FILE}`;
  if (!fs.existsSync(target)) return null;
  try {
    fs.rmSync(target, { force: true });
    return target;
  } catch {
    return null;
  }
}

/** Whether a login entry exists for this platform right now. */
export function isAutostartInstalled({ platform = process.platform } = {}): boolean {
  if (platform === 'win32') {
    const result = Bun.spawnSync({
      cmd: [
        'reg', 'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
        '/v', WINDOWS_RUN_VALUE,
      ],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return result.exitCode === 0;
  }
  const target = getAutostartEntryPath(platform);
  return Boolean(target && fs.existsSync(target));
}
