/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one `omp plugin …` runner.
 *
 * Mutations are delegated to omp's own CLI: omp owns the plugin registries, the
 * cache and the `node_modules` symlinks, and Kabmo must not re-implement a
 * write whose format omp also reads at runtime.
 *
 * Measured against omp 18.4.4: `--json` is output formatting only and several
 * handlers ignore it (install, `marketplace add/remove/update`, upgrade). Those
 * answer on stdout as text and report failure on stderr with exit code 1, so the
 * runner returns BOTH streams and lets the route decide — a caller that read
 * stdout alone would report every failure as an empty success.
 */

import { resolveOmpBin } from '@/server/lib/omp/core/cli';
import { childEnv } from '@/server/lib/fs/child-env';

export const LIST_TIMEOUT_MS = 30_000;
export const INSTALL_TIMEOUT_MS = 300_000;
export const MUTATE_TIMEOUT_MS = 120_000;

export interface PluginCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Run one `omp plugin …` command in a directory. Never throws for a non-zero exit. */
export async function runPluginCli(args: string[], cwd: string, timeout: number): Promise<PluginCommandResult> {
  const bin = resolveOmpBin();
  if (!bin) return { ok: false, stdout: '', stderr: 'omp binary not found' };
  try {
    const proc = Bun.spawn({
      env: childEnv(),
      cmd: [bin, 'plugin', ...args],
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { ok: exitCode === 0, stdout, stderr };
  } catch (error) {
    return { ok: false, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The failure line of a CLI result, preferring stderr (where omp reports).
 *
 * omp prefixes its failures with a status glyph and no ANSI colour when the
 * stream is not a TTY, so the leading non-word characters are stripped to leave
 * the sentence itself ("Failed to install x@y: Error: Plugin \"x\" not found…").
 */
export function pluginCliError(result: PluginCommandResult): string {
  const text = (result.stderr.trim() || result.stdout.trim()).split('\n').filter(Boolean).pop() ?? '';
  return text.replace(/^[^\w@/]*/, '').trim() || 'omp plugin command failed';
}
