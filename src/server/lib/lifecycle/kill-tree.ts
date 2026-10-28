/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Process-tree termination, for every child this server spawns.
 *
 * POSIX: a child spawned `detached` is a process-group leader, so signalling the
 * negative pid reaches its grandchildren too — an omp child's LSP servers, a
 * shell's foreground command. Signalling the pid alone leaves them behind, and
 * a grandchild that holds a pipe open keeps the parent's `exited` promise
 * pending until it finishes on its own.
 *
 * Windows: there is no negative-pid equivalent, so `taskkill /t` walks the
 * tree the OS recorded instead. `taskkill` is preferred over `process.kill`
 * because only it reaches grandchildren, and it is a spawn rather than a
 * syscall — so it can fail (missing from PATH, a locked process) and the direct
 * kill is the fallback.
 *
 * Both branches degrade rather than throw: tearing a child down is the last
 * thing a dying server does, and an exception there would skip the rest of the
 * shutdown. A missing pid is a no-op, not an error.
 *
 * This lived in `omp/rpc/` until the terminal needed it: a shell's foreground
 * command is the same problem as an omp child's LSP, and a module under `omp/`
 * is not the terminal's to import. It is `lifecycle/` because that is where
 * process concerns already live (`proc/`, `fd-pressure`, `restart`).
 */

/** What the Windows branch needs from the outside, so a test can drive it. */
import { childEnv } from '@/server/lib/fs/child-env';

export interface KillTreeDeps {
  platform?: NodeJS.Platform;
  /**
   * Starts `taskkill`. Returns a handle whose `exited` resolves to the exit
   * code, or null when the spawn itself failed. A test supplies a fake and
   * records the argv; production omits it.
   */
  spawnTaskkill?: (cmd: string[]) => { exited: Promise<number | null> } | null;
  /** Signal the direct child. */
  kill?: (pid: number, signal: NodeJS.Signals) => void;
}

function signalDirect(pid: number, signal: NodeJS.Signals, deps: KillTreeDeps): void {
  try {
    (deps.kill ?? process.kill)(pid, signal);
  } catch {
    // Already gone.
  }
}

function killTreeWindows(pid: number, force: boolean, signal: NodeJS.Signals, deps: KillTreeDeps): void {
  const argv = ['taskkill', '/pid', String(pid), '/t', ...(force ? ['/f'] : [])];

  const spawn = deps.spawnTaskkill ?? ((cmd: string[]) => {
    try {
      return Bun.spawn({
        cmd,
        stdout: 'ignore',
        stderr: 'ignore',
        windowsHide: true,
        env: childEnv(),
      });
    } catch {
      return null;
    }
  });

  const reaper = spawn(argv);
  if (!reaper) {
    signalDirect(pid, signal, deps);
    return;
  }
  // `taskkill` reports a tree it could not reach with a non-zero exit, and a
  // process that exited between the spawn and the call with a zero one — the
  // code is the only thing that tells them apart.
  void reaper.exited.then(
    (code) => {
      if (!code) return;
      signalDirect(pid, signal, deps);
    },
    () => signalDirect(pid, signal, deps),
  );
}

/**
 * Terminate `pid` and everything below it.
 *
 * `force` selects `taskkill /f` on Windows; on POSIX it is ignored, because the
 * signal already carries the severity (`SIGTERM` asks, `SIGKILL` does not).
 */
export function killProcessTree(
  pid: number | undefined,
  force: boolean,
  signal: NodeJS.Signals,
  deps: KillTreeDeps = {},
): void {
  if (!pid) return;
  const platform = deps.platform ?? process.platform;

  if (platform === 'win32') {
    killTreeWindows(pid, force, signal, deps);
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch {
    // Not a group leader (or the group is gone): fall back to the child itself.
    signalDirect(pid, signal, deps);
  }
}
