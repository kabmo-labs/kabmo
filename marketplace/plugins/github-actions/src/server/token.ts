/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where the credential comes from, in the order that keeps the common case
 * zero-config:
 *
 * 1. the plugin's own `token` setting;
 * 2. `GITHUB_TOKEN` / `GH_TOKEN` in the server's environment;
 * 3. `gh auth token --hostname <host>`, cached per host INCLUDING a failure —
 *    a machine with `gh` installed but logged out must not pay a spawn per read.
 *
 * A missing token is a legitimate state, not an error: runs, jobs and steps read
 * anonymously on a public repository. What does not: the job-log endpoint
 * answers `403 Must have admin rights` without one (measured), so the log pane
 * names that instead of drawing an empty box.
 *
 * **The token never leaves this module.** It is spent as a header and reported
 * as a source name; it is never part of an RPC result, a note or a log line.
 */

export type TokenSource = 'setting' | 'env' | 'cli' | null;

export interface ResolvedToken {
  token: string | null;
  source: TokenSource;
  /** Why the CLI did not answer, when it was tried. Never contains a token. */
  hint?: string;
}

export interface TokenInput {
  /** The plugin's `token` setting. */
  setting: string | null;
  env: Record<string, string | undefined>;
  host: string;
}

/** Per-host answers, failed ones included. */
const cache = new Map<string, ResolvedToken>();

/** Test seam: forget every cached answer. */
export function resetTokenCache(): void {
  cache.clear();
}

function fromCli(host: string): ResolvedToken {
  try {
    const result = Bun.spawnSync(['gh', 'auth', 'token', '--hostname', host], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 5_000,
    });
    const token = result.stdout ? result.stdout.toString().trim() : '';
    if (result.exitCode === 0 && token) return { token, source: 'cli' };
    const stderr = result.stderr ? result.stderr.toString().trim().split('\n')[0] ?? '' : '';
    return { token: null, source: null, hint: stderr || `gh exited ${result.exitCode}` };
  } catch (cause) {
    // A missing binary throws rather than exiting non-zero; both mean "no gh".
    return { token: null, source: null, hint: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * The credential for one host.
 *
 * An explicitly empty setting falls through to the environment, because the
 * setting's default is empty and a user who has `GITHUB_TOKEN` exported should
 * not have to paste it into a form.
 */
export function resolveToken(input: TokenInput): ResolvedToken {
  const setting = (input.setting ?? '').trim();
  if (setting) return { token: setting, source: 'setting' };

  const env = (input.env.GITHUB_TOKEN ?? input.env.GH_TOKEN ?? '').trim();
  if (env) return { token: env, source: 'env' };

  const cached = cache.get(input.host);
  if (cached) return cached;
  const resolved = fromCli(input.host);
  cache.set(input.host, resolved);
  return resolved;
}
