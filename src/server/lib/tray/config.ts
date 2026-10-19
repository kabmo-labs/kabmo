/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The tray config document — everything a platform host script needs to draw the
 * icon, resolved once by the server so no host re-derives a path.
 *
 * It is a FILE rather than argv or env because a host is not always this
 * process's child: the same document is what a login entry's host reads, and a
 * host that was started days ago must still find the paths of the install that
 * wrote it. Written per port, beside the other per-port tray state.
 */

import fs from 'node:fs';

import { getDataDir } from '@/server/lib/lifecycle/paths';

/** The tray's own name, shown in the menu and the tooltip. */
export const TRAY_LABEL = 'Kabmo';

/** Directory holding the tray's config and the extracted host scripts. */
export function getTrayDir(): string {
  const dir = `${getDataDir()}/tray`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Directory the platform host script is copied into before it runs. */
export function getTrayHostDir(): string {
  const dir = `${getTrayDir()}/host`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Per-port config: the one document a platform host reads. */
export function getTrayConfigPath(port: number | string): string {
  return `${getTrayDir()}/${port}.config.json`;
}

/** What a host is told about the server it fronts. */
export interface TrayConfig {
  version: number;
  port: number;
  host: string;
  tls: boolean;
  url: string;
  label: string;
  /** Bun binary the host uses to reach the CLI for an action. */
  bun: string;
  /** CLI entry (`src/cli/ompchamber.js`) the host shells back into. */
  cli: string;
  /** Packaged icon; falls back to the title when it does not load. */
  icon: string;
  logFile: string;
  dataDir: string;
  pidFile: string;
  /**
   * Whether a login entry exists when this config was written.
   *
   * Baked in rather than probed by the host, so the menu can label the row
   * ("Start at Login" vs "Disable Start at Login") without a subprocess — and
   * re-read on every menu open, because the config is rewritten whenever the
   * server starts.
   */
  loginInstalled: boolean;
  createdAt: string;
}

/** `http://host:port`, with a bind-any address resolved to loopback. */
export function trayUrl(port: number, host: string, tls: boolean): string {
  const scheme = tls ? 'https' : 'http';
  const target = !host || host === '0.0.0.0' || host === '::' || host === 'localhost' ? '127.0.0.1' : host;
  return `${scheme}://${target}:${port}`;
}

/** Resolve `..`/symlinks; fall back to the input when it does not exist. */
function canonicalize(value: string): string {
  try {
    return fs.realpathSync(value);
  } catch {
    return value;
  }
}

/** Build the config for a server on `port`. */
export function buildTrayConfig({ pkgRoot, port, host, tls, dataDir, bun, icon, pidFile, loginInstalled }: {
  pkgRoot: string;
  port: number;
  host: string;
  tls: boolean;
  dataDir: string;
  bun: string;
  icon: string;
  pidFile: string;
  loginInstalled: boolean;
}): TrayConfig {
  return {
    version: 1,
    port,
    host: host ?? '127.0.0.1',
    tls: Boolean(tls),
    url: trayUrl(port, host, tls),
    label: TRAY_LABEL,
    bun,
    // Canonicalized, never the raw join: `resolvePath` does not collapse a `..`
    // segment, so a path assembled from a `..`-bearing root would carry it into
    // a login entry's argv, where it is interpreted much later. Measured: a
    // generated LaunchAgent held `<pkg>/src/cli/../../src/cli/ompchamber.js`.
    cli: canonicalize(`${pkgRoot}/src/cli/ompchamber.js`),
    icon: canonicalize(icon),
    logFile: `${dataDir}/logs/ompchamber-${port}.log`,
    dataDir,
    pidFile,
    loginInstalled: Boolean(loginInstalled),
    createdAt: new Date().toISOString(),
  };
}

/** Persist the config for its port (mode 0600, atomic rename). */
export function writeTrayConfig(config: TrayConfig): string {
  const target = getTrayConfigPath(config.port);
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, target);
  return target;
}

/** The stored config for `port`, or null when there is none or it is unreadable. */
export function readTrayConfig(port: number | string): TrayConfig | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(getTrayConfigPath(port), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const config = parsed as Record<string, unknown>;
    if (typeof config.port !== 'number' || typeof config.cli !== 'string') return null;
    return config as unknown as TrayConfig;
  } catch {
    return null;
  }
}
