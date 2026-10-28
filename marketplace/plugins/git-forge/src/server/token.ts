/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where the credential comes from.
 *
 * Four sources, tried in an order that keeps the common case zero-config:
 *
 * 1. the plugin's own setting (the only one that works on a machine with no
 *    `gh`/`glab` installed, and the one a panel user can edit);
 * 2. the environment (`GITHUB_TOKEN`, `GH_TOKEN`, `GITLAB_TOKEN`) — what a CI
 *    runner or a shell already exports;
 * 3. the vendor CLI, when one is installed and logged in. `gh auth token` is the
 *    reason a developer who has never opened this panel still sees a private
 *    repository's issues on the first click;
 * 4. nothing, which is a legitimate state: public repositories read anonymously.
 *
 * The CLI is read ONCE per host per process and cached, because it costs a
 * process spawn (~40 ms measured for `gh auth token`) and the answer does not
 * change while the server runs. A failure is cached too: a machine with `gh`
 * installed but not logged in must not pay that spawn on every panel open.
 *
 * **The token never leaves this module.** It is passed to the adapters as a
 * header value and is never part of an RPC result, a note or a log line — the
 * settings screen shows a secret as "set", and a panel has no reason to know it.
 */

import type { ForgeProvider } from '../protocol';

export interface TokenSources {
  /** The plugin's own `token` setting. */
  setting: string | null;
  env: NodeJS.ProcessEnv;
  /** Injected by the tests; production reads the environment and the CLI. */
  run?: (argv: string[]) => { ok: boolean; stdout: string };
}

/**
 * The environment variable each provider's tooling already uses.
 *
 * Gitea and Bitbucket have no CLI of their own, so a token is the only source
 * for them — stated rather than invented, because guessing a binary name would
 * spawn a process that does not exist on every read.
 */
const ENV_KEYS: Record<ForgeProvider, readonly string[]> = {
  github: ['GITHUB_TOKEN', 'GH_TOKEN'],
  gitlab: ['GITLAB_TOKEN', 'GLAB_TOKEN'],
  gitea: ['GITEA_TOKEN'],
  bitbucket: ['BITBUCKET_TOKEN'],
};

/**
 * The CLI that can answer a stored credential, per provider.
 *
 * Absent for Gitea and Bitbucket: neither ships a credential-reading CLI, and a
 * table entry naming one that does not exist would spawn a missing binary on
 * every panel open.
 */
const CLI: Partial<Record<ForgeProvider, readonly string[]>> = {
  github: ['gh', 'auth', 'token'],
  gitlab: ['glab', 'auth', 'status'],
};

/** One resolved token, and the source that supplied it. */
export interface ResolvedToken {
  token: string | null;
  /** `setting`, `environment`, `cli` or `none` — for the panel's own note. */
  source: 'setting' | 'environment' | 'cli' | 'none';
}

/** A CLI answer, cached per provider for the life of the process. */
const cliCache = new Map<ForgeProvider, string | null>();

/**
 * The default runner: an argv spawn, never a shell string.
 *
 * **A missing binary THROWS from `Bun.spawnSync`** (`Executable not found in
 * $PATH`), and it is the ordinary case here — a machine without `gh` or `glab`
 * installed. Measured: the throw escaped `resolveToken` and failed the whole
 * read with "Executable not found in $PATH: glab", so a repository with a public
 * forge could not be browsed at all. A missing CLI is simply no answer.
 */
function defaultRun(argv: string[]): { ok: boolean; stdout: string } {
  try {
    const result = Bun.spawnSync(argv, { stdout: 'pipe', stderr: 'ignore', timeout: 5_000 });
    return { ok: result.exitCode === 0, stdout: result.stdout ? result.stdout.toString() : '' };
  } catch {
    return { ok: false, stdout: '' };
  }
}

/**
 * The CLI's answer, or null.
 *
 * `glab` has no `auth token` verb, so its answer is parsed out of `auth status`,
 * whose output carries the token when it prints one. A version that does not
 * print it answers null and the panel simply reads anonymously — the honest
 * outcome, rather than a guessed token.
 */
function fromCli(provider: ForgeProvider, run: (argv: string[]) => { ok: boolean; stdout: string }): string | null {
  const argv = CLI[provider];
  if (!argv) return null;
  if (cliCache.has(provider)) return cliCache.get(provider) ?? null;

  const result = run([...argv]);
  let token: string | null = null;
  if (result.ok) {
    const line = result.stdout.trim();
    if (provider === 'github') {
      token = /^[A-Za-z0-9_\-.]{20,}$/.test(line) ? line : null;
    } else {
      const match = line.match(/Token:\s*(\S+)/);
      token = match ? match[1] : null;
    }
  }
  cliCache.set(provider, token);
  return token;
}

/** Clear the CLI cache. The tests use it; a running server has no reason to. */
export function resetTokenCache(): void {
  cliCache.clear();
}

/** The credential for one provider, and where it came from. */
export function resolveToken(provider: ForgeProvider, sources: TokenSources): ResolvedToken {
  const setting = (sources.setting ?? '').trim();
  if (setting) return { token: setting, source: 'setting' };

  for (const key of ENV_KEYS[provider]) {
    const value = (sources.env[key] ?? '').trim();
    if (value) return { token: value, source: 'environment' };
  }

  const token = fromCli(provider, sources.run ?? defaultRun);
  return token ? { token, source: 'cli' } : { token: null, source: 'none' };
}
