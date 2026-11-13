/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which browser engine the session's omp agent will use, and whether the
 * Browser Agent panel can mirror it.
 *
 * omp opens tabs in its own WebKit engine (ABKit) by default when that engine
 * is installed, and only falls back to the managed Chromium daemon otherwise.
 * The panel mirrors Chromium over CDP; WebKit has no CDP endpoint and no frame
 * stream, so a WebKit session is invisible to it. This module answers the one
 * question the panel needs before it can explain that: is the next open going
 * to be WebKit?
 *
 * The answer is read from omp's own config (`browser.webkit`, default `true`)
 * plus the presence of the host executable, because a setting that names an
 * engine which is not installed does not select it — omp falls back to
 * Chromium and the panel works.
 */

import { homedir } from 'node:os';
import * as path from 'node:path';
import { getOmpConfigValue } from '@/server/lib/omp/config/config-cli';
import type { BrowserEngineState } from '@/shared/types';

/** Where omp installs ABKit when `browser.webkitPath` is unset. */
const DEFAULT_ENGINE_DIR = ['.o2', 'lib', 'abkit'] as const;

export interface BrowserEngineDeps {
  /** Read one omp config key; defaults to the real `omp config get`. */
  readConfig?: (key: string) => Promise<unknown>;
  /** Whether a file exists; defaults to `Bun.file(...).exists()`. */
  exists?: (file: string) => Promise<boolean>;
  home?: string;
  platform?: NodeJS.Platform;
}

/** `~` and `~/…` against the given home, so a test never reads the real one. */
function expandHome(value: string, home: string): string {
  if (value === '~') return home;
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(home, value.slice(2));
  return value;
}

/**
 * The paths that could hold the ABKit host.
 *
 * `browser.webkitPath` names either the host executable or an ABKit engine
 * directory that holds it as `ABHost` (`ABHost.exe` on Windows), so both
 * readings are offered and the caller accepts the first that exists.
 */
export function webkitHostCandidates(
  configured: unknown,
  home: string,
  platform: NodeJS.Platform,
): string[] {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const exe = platform === 'win32' ? 'ABHost.exe' : 'ABHost';
  if (typeof configured === 'string' && configured.trim()) {
    const expanded = expandHome(configured.trim(), home);
    return [expanded, join(expanded, exe)];
  }
  return [join(home, ...DEFAULT_ENGINE_DIR, exe)];
}

/**
 * The engine the next `browser.open` will use.
 *
 * A config read that fails is NOT treated as "Chromium": the panel would then
 * promise a mirror it cannot deliver. It keeps the documented default (WebKit
 * on) and lets the install check decide.
 */
export async function readBrowserEngineState(
  deps: BrowserEngineDeps = {},
): Promise<BrowserEngineState> {
  const readConfig = deps.readConfig ?? getOmpConfigValue;
  const exists = deps.exists ?? ((file: string) => Bun.file(file).exists());
  const home = deps.home ?? homedir();
  const platform = deps.platform ?? process.platform;

  const [webkitValue, pathValue] = await Promise.all([
    readConfig('browser.webkit').catch(() => undefined),
    readConfig('browser.webkitPath').catch(() => undefined),
  ]);
  const webkit = webkitValue !== false;
  const candidates = webkitHostCandidates(pathValue, home, platform);
  const installed = (
    await Promise.all(candidates.map((file) => exists(file).catch(() => false)))
  ).some(Boolean);

  return { webkit, engineInstalled: installed, effective: webkit && installed ? 'webkit' : 'chromium' };
}
