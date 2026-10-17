/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun-native replacement for the former `util.promisify(exec)` pattern.
 *
 * Runs a command through /bin/sh (matching node's `exec` shell semantics) and
 * captures stdout/stderr as text. Exit handling is explicit: unlike the
 * promisified node API, Bun never throws for non-zero exits — callers check
 * `exitCode`. `error` carries the spawn failure only (ENOENT, timeout kill is
 * surfaced via signalCode instead).
 *
 * The timeout signals the whole process GROUP. A shell that forked a child
 * (`sh -c 'sleep 5'` does on Linux) keeps stdout open from that child, so
 * killing only the shell leaves the reads below blocked until the child exits
 * on its own — measured at the full 5s instead of the 100ms timeout. Bun's own
 * `timeout` option signals the shell alone, which is why the kill is ours.
 *
 * Windows has no POSIX process group, and this used to say so and stop there —
 * which meant a timed-out command there kept running, because the shell was
 * signalled and its child was not. `killProcessTree` closes that: `taskkill /t`
 * walks the tree the OS recorded, and the direct kill remains its fallback.
 * `detached` stays POSIX-only (it is what makes `-pid` addressable, and Windows
 * has no equivalent), so the Windows branch passes the shell's own pid.
 */

import { killProcessTree } from '@/server/lib/lifecycle/kill-tree';

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  killed: boolean;
  error?: Error;
}

export interface ShellOptions {
  cwd?: string;
  /** Signal the process group after this many milliseconds. */
  timeout?: number;
  /** Kill the process once it has emitted more than this many bytes (Bun-native). */
  maxBuffer?: number;
  env?: Record<string, string | undefined>;
  /**
   * Overridable so the Windows timeout branch is reachable from a POSIX test.
   * Production omits it; the process's own platform is the answer.
   */
  platform?: NodeJS.Platform;
  /**
   * How the timeout terminates the child. Production omits it and gets
   * `killProcessTree`, which is the whole point of the change: the shell alone
   * is not enough when it forked. A test injects a spy, because the Windows
   * branch's `taskkill` cannot be observed from a POSIX host — there is no such
   * binary and no process group, so asserting the outcome would test the
   * absence of `taskkill` rather than the routing.
   */
  killTree?: (pid: number, force: boolean, signal: NodeJS.Signals) => void;
  /**
   * TEST ONLY: lead a process group on a platform whose branch would not.
   *
   * A POSIX host cannot reproduce the Windows branch's outcome without it —
   * `dash` forks a lone `sleep`, so the grandchild keeps the pipe open and a
   * shell-only signal never resolves the reads. The Windows branch itself does
   * NOT detach (there is no group to address; `taskkill /t` walks the OS tree),
   * so production must never set this.
   */
  detachForTest?: boolean;
}

export function runShell(command: string, options: ShellOptions = {}): Promise<ShellResult> {
  const timeout = options.timeout;
  const platform = options.platform ?? process.platform;
  // Only POSIX needs the shell to lead a group that `-pid` can address.
  const detached = timeout !== undefined && (platform !== 'win32' || options.detachForTest === true);
  const proc = Bun.spawn({
    cmd: ['sh', '-c', command],
    cwd: options.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    detached,
    maxBuffer: options.maxBuffer,
    env: options.env ? { ...Bun.env, ...options.env } : undefined,
  });
  const timer = timeout === undefined
    ? undefined
    : setTimeout(() => {
        // The tree, not the shell alone: a forked child holding the pipe open
        // is exactly what makes a single kill look like a hang.
        (options.killTree ?? killProcessTree)(proc.pid, false, 'SIGTERM');
      }, timeout);
  return (async () => {
    let error: Error | undefined;
    let stdout = '';
    let stderr = '';
    try {
      [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
    }
    const exitCode = await proc.exited;
    clearTimeout(timer);
    return {
      stdout,
      stderr,
      exitCode,
      signalCode: proc.signalCode,
      killed: proc.killed,
      error,
    };
  })();
}

/** True when the result represents a usable success (exit 0 and no spawn error). */
export function shellOk(result: ShellResult): boolean {
  return result.error === undefined && result.exitCode === 0;
}
