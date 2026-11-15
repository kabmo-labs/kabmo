/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One argv spawn for the Connect page's provider CLIs.
 *
 * `tailscale` and `cloudflared` are both invoked as argv, never through a shell:
 * the only variable part is a port number this process chose, and a shell would
 * add an expansion surface for no benefit. The timeout is mandatory at every
 * call site because both CLIs can block on a daemon that is not answering —
 * `tailscale status` against a stopped daemon hangs, and a settings page that
 * waits on it looks like a broken server.
 */

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  /** Set when the binary could not be spawned at all. */
  error: string | null;
}

export interface RunOptions {
  timeoutMs?: number;
  env?: Record<string, string>;
}

/** Run `argv` and collect both streams. Never throws. */
export async function run(argv: string[], options: RunOptions = {}): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
  try {
    proc = Bun.spawn({
      cmd: argv,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...Bun.env, ...options.env },
    });
  } catch (error) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      code: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const timer = setTimeout(() => {
    try {
      proc.kill('SIGKILL');
    } catch {
      // Already gone: the command finished inside its own timeout.
    }
  }, timeoutMs);

  // The timeout must SETTLE the call, not merely kill the process. A CLI that
  // spawns a helper holding the pipe open leaves `Response(proc.stdout).text()`
  // pending forever, and the settings page then waits on a request that never
  // answers — measured with `tailscale serve --bg`, which hung the route for the
  // full three minutes the smoke test allowed.
  const deadline = Promise.withResolvers<RunResult>();
  setTimeout(() => {
    deadline.resolve({
      ok: false,
      stdout: '',
      stderr: '',
      code: null,
      error: `timed out after ${timeoutMs} ms`,
    });
  }, timeoutMs + 250);

  try {
    return await Promise.race([
      (async (): Promise<RunResult> => {
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const code = await proc.exited;
        return { ok: code === 0, stdout, stderr, code, error: null };
      })(),
      deadline.promise,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The absolute path of a binary on PATH, or null. */
export function which(binary: string): string | null {
  try {
    return Bun.which(binary) ?? null;
  } catch {
    return null;
  }
}
