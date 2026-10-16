// ESM port of ompweb/bin/process-lifecycle.js.
// Semantics are preserved exactly: POSIX signals the whole process group
// (`process.kill(-pid, signal)`) with a `child.kill(signal)` fallback, while
// win32 shells out to `taskkill /pid <pid> /t [/f]`.

const forwardedSignals = ['SIGINT', 'SIGTERM'];
const shutdownTimeoutMs = 5_000;

// Time to wait for a terminated process tree to actually exit.
export const STOP_TIMEOUT_MS = 5_000;

// Signal numbers for the 128+N shell exit-code convention (os.constants.signals
// equivalent; only signals forwarded by this module are needed).
const SIGNAL_NUMBERS = { SIGINT: 2, SIGTERM: 15, SIGKILL: 9 };

function getSignalExitCode(signal) {
  const signalNumber = signal ? SIGNAL_NUMBERS[signal] : undefined;
  return typeof signalNumber === 'number' ? 128 + signalNumber : 1;
}

/**
 * Whether `process.kill(-pid, …)` may be used on this PID.
 *
 * The negative form signals a process GROUP, and POSIX reserves `-1` for "every
 * process this user may signal" — so a pid of 1 or 0 must never reach it. A
 * stale instance record naming such a PID would otherwise turn `ompchamber stop`
 * into a signal to the whole session, which is a far worse outcome than a stop
 * that fails. Kept as a named predicate so the rule is testable WITHOUT
 * signalling anything.
 */
export function isGroupKillable(pid) {
  return Number.isInteger(pid) && pid > 1;
}

/**
 * End a process (and, on Windows, its tree).
 *
 * `spawn` is injectable for the same reason `platform` is: the Windows branch
 * runs `taskkill`, and the host this project is developed on has no such binary
 * — so the branch's failure modes (a missing binary, a non-zero exit, a success)
 * could not be exercised at all. Bun resolves a child's executable from the PATH
 * snapshot taken at process start, so a stub placed on PATH afterwards is NOT
 * found (verified), and the seam is the only way to reach those paths.
 */
export function killChildTree(child, force, platform = process.platform, gracefulSignal = 'SIGTERM', spawn = Bun.spawn) {
  if (platform === 'win32' && child.pid) {
    const fallback = () => {
      try { child.kill(force ? 'SIGKILL' : 'SIGTERM'); } catch {}
    };
    // `taskkill` is the only way to end a whole tree on Windows, but spawning it
    // can fail on its own: measured, `Bun.spawn` THROWS `Executable not found in
    // $PATH: "taskkill"` when the binary is missing, and that throw escaped as an
    // exception from a stop that was otherwise working — the caller's escalation
    // never ran. The fallback is the single-PID kill, which on Windows is
    // forceful either way (POSIX signals do not exist there, so Node maps it to
    // TerminateProcess): a host without taskkill loses the tree kill, not the
    // stop.
    let reaper;
    try {
      reaper = spawn({
        cmd: ['taskkill', '/pid', String(child.pid), '/t', ...(force ? ['/f'] : [])],
        stdout: 'ignore',
        stderr: 'ignore',
        windowsHide: true,
      });
    } catch {
      fallback();
      return;
    }
    void reaper.exited.then((code) => {
      if (code !== 0) fallback();
    }, fallback);
    reaper.unref?.();
    return;
  }

  const signal = force ? 'SIGKILL' : gracefulSignal;
  if (platform !== 'win32' && isGroupKillable(child.pid)) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {}
  }

  try { child.kill(signal); } catch {}
}

function childHasExited(child) {
  return (child.exitCode !== null && child.exitCode !== undefined)
    || (child.signalCode !== null && child.signalCode !== undefined);
}

function waitForChildExit(child, timeoutMs) {
  if (childHasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (exited) => {
      clearTimeout(timer);
      resolve(exited);
    };
    const timer = setTimeout(() => finish(childHasExited(child)), timeoutMs);
    timer.unref?.();
    void child.exited.then(() => finish(true));
  });
}

export async function terminateChildProcess(child, timeoutMs = STOP_TIMEOUT_MS, platform = process.platform, spawn = Bun.spawn) {
  if (childHasExited(child)) return true;
  const exited = waitForChildExit(child, timeoutMs);
  killChildTree(child, true, platform, 'SIGTERM', spawn);
  return exited;
}

export function wireChildProcessLifecycle(child, parentProcess = process, timeoutMs = shutdownTimeoutMs, handleChildExit) {
  const signalHandlers = new Map();
  let shutdownTimer;
  let settled = false;
  const platform = parentProcess.platform ?? process.platform;

  const forceKill = () => killChildTree(child, true, platform);

  for (const signal of forwardedSignals) {
    const handler = () => {
      if (shutdownTimer) {
        forceKill();
        return;
      }

      shutdownTimer = setTimeout(forceKill, timeoutMs);
      shutdownTimer.unref?.();
      killChildTree(child, false, platform, signal);
    };
    signalHandlers.set(signal, handler);
    parentProcess.on(signal, handler);
  }

  void child.exited.then((code) => {
    if (settled) return;
    settled = true;
    if (shutdownTimer) clearTimeout(shutdownTimer);

    for (const [forwardedSignal, handler] of signalHandlers) {
      parentProcess.removeListener(forwardedSignal, handler);
    }
    if (handleChildExit?.({ code, signal: child.signalCode }) === true) return;

    parentProcess.exit(code ?? getSignalExitCode(child.signalCode));
  });
}
