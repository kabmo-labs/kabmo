/**
 * oh-my-pi (`omp`) update check + apply.
 *
 * The check reads npm — `@oh-my-pi/pi-coding-agent`, the package `omp update`
 * itself resolves against — for the newest version, and `omp --version` for the
 * one installed. omp's own `update --check` is deliberately NOT used to learn the
 * status: it prints its findings, and parsing another program's prose for "a
 * version exists" broke on every channel change (`Switching to stable …`,
 * `Forcing reinstall of …`) while answering nothing when it failed. Asking the
 * same registry for the same package, then comparing locally, reports exactly
 * what a user's `bun add -g` would install.
 *
 * `apply` still runs `omp update`, because the install mechanics — binary
 * download, launcher retirement, verification — are omp's own.
 */

import { invalidateOmpCliCache, resolveOmpBin } from '@/server/lib/omp/core/cli';
import { fetchNpmLatest, OMP_PACKAGE } from '@/server/lib/updates/npm';
import { pumpStream } from '@/server/lib/updates/install-steps';
import { isNewer } from '@/shared/lib/updates/semver';
import type { UpdateTargetInfo } from '@/shared/types/updates';

/** Runs a command, capturing stdout/stderr separately. Non-zero exits keep the captured output. */
async function runCapture(bin: string, args: string[], timeoutMs: number, maxBuffer: number): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const proc = Bun.spawn({
    cmd: [bin, ...args],
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: timeoutMs,
    maxBuffer,
    env: { ...Bun.env, PAGER: 'cat', FORCE_COLOR: '0' },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

function combined(stdout?: string, stderr?: string): string {
  return [stdout ?? '', stderr ?? ''].join('\n');
}

/** `omp/18.6.0` → `18.6.0`. The binary names itself, so no config file is read. */
function parseOmpVersion(output: string): string | null {
  return output.match(/^omp\/(\S+)/m)?.[1] ?? null;
}

export async function checkOmpUpdate(): Promise<UpdateTargetInfo> {
  const bin = resolveOmpBin();
  if (!bin) {
    return {
      current: null,
      latest: null,
      updateAvailable: false,
      installed: false,
      error: 'omp binary not found',
    };
  }

  let current: string | null = null;
  let execMessage: string | null = null;
  try {
    const { stdout, stderr, exitCode } = await runCapture(bin, ['--version'], 30000, 1024 * 1024);
    current = parseOmpVersion(combined(stdout, stderr));
    if (exitCode !== 0) execMessage = `omp --version exited with code ${exitCode}`;
  } catch (err) {
    execMessage = err instanceof Error ? err.message : String(err);
  }

  const latest = await fetchNpmLatest(OMP_PACKAGE);
  // With no version on disk there is nothing to compare, and "an update exists"
  // would be a claim about a copy that could not be read.
  const updateAvailable = Boolean(current && latest && isNewer(latest, current));

  let error: string | null = null;
  if (!current) error = execMessage ?? 'Could not determine the installed omp version';
  else if (!latest) error = 'Could not read the latest oh-my-pi version from npm';

  return { current, latest, updateAvailable, installed: true, error };
}

export interface OmpUpdateHooks {
  /** Receives command output as it arrives (the console streams it). */
  onLine?: (chunk: string) => void;
}

/** `omp update` result. `updated` is what the caller needs to decide whether to
 *  recycle anything: "already up to date" is a success that must not bounce a
 *  single process, and the two are the same exit code. */
export interface OmpUpdateOutcome {
  output: string;
  updated: boolean;
}

export async function applyOmpUpdate(hooks: OmpUpdateHooks = {}): Promise<OmpUpdateOutcome> {
  const bin = resolveOmpBin();
  if (!bin) throw new Error('omp binary not found');

  const proc = Bun.spawn({
    cmd: [bin, 'update'],
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 300_000,
    maxBuffer: 1024 * 1024 * 4,
    env: { ...Bun.env, PAGER: 'cat', FORCE_COLOR: '0' },
  });

  // Streamed, not buffered: `omp update` prints its stages as it goes, and the
  // console draws them. A `new Response(proc.stdout).text()` here would hold
  // every byte until the process exits — the spinner-blind behavior this path
  // exists to remove. `maxBuffer` still bounds each stream, so a runaway child
  // is capped exactly as it was under the buffered read.
  let exitCode: number | null = null;
  let stdout = '';
  let stderr = '';
  try {
    [stdout, stderr] = await Promise.all([
      pumpStream(proc.stdout, hooks.onLine),
      pumpStream(proc.stderr, hooks.onLine),
    ]);
    exitCode = await proc.exited;
  } finally {
    // The next request must re-probe the binary: `omp update` can replace its
    // own launcher, and a cached path may no longer exist.
    invalidateOmpCliCache();
  }

  if (exitCode !== 0) {
    throw new Error(combined(stdout, stderr).trim() || `omp update exited with code ${exitCode}`);
  }
  const output = combined(stdout, stderr).trim();
  // The up-to-date case is a SUCCESS with the same exit code, and it is the one
  // where nothing on disk moved — so nothing may be recycled either. The phrase
  // is the same one `checkOmpUpdate` matches to decide `updateAvailable: false`.
  return { output, updated: !/already up to date/i.test(output) };
}
