/**
 * @license
 * SPDX-License-Identifier: MIT
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
  /**
   * The remote's host, so the CLI answers for THAT instance.
   *
   * Both CLIs can be logged into several hosts, and their default is whichever
   * one is active — so a token read without the host is a token for the wrong
   * server, which the read then sends and receives a 401 for.
   */
  host?: string;
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

/** One command a CLI can answer with, and the flag that scopes it to a host. */
interface CliCommand {
  argv: readonly string[];
  /** Each CLI spells its host flag differently (`gh auth token` vs `glab config`). */
  hostFlag: string;
  /**
   * How to read the answer.
   *
   * `bare` is a command that prints the token and nothing else (`gh auth token`,
   * `glab config get token`), so the whole output is the credential — including a
   * SHORT one, which a length test would wrongly reject. `report` is
   * `glab auth status`, whose token sits on one labelled line of a multi-line
   * summary.
   */
  output: 'bare' | 'report';
}

/**
 * The CLI commands that can answer a stored credential, per provider, in the
 * order they are tried.
 *
 * Absent for Gitea and Bitbucket: neither ships a credential-reading CLI, and a
 * table entry naming one that does not exist would spawn a missing binary on
 * every panel open.
 *
 * **GitLab tries the LOCAL read first, and that is a measured decision.**
 * `glab config get token` answers from the config file in ~0.5 s with no network
 * (`glab` 1.126). `glab auth status` VERIFIES the token against the API first:
 * measured on a host behind a VPN, it spent 30 s on that call and was still
 * running when the spawn was killed, so a perfectly good stored token was read as
 * "no credential" — and the panel said "reading anonymously" over a repository
 * it could have read. `auth status --show-token` stays as the fallback because it
 * is the only command that can reach a token in the OS keyring.
 *
 * **GitLab needs `--show-token` on the fallback.** `glab auth status` masks the
 * token it found (`******`) without that flag, and a masked value sent as a
 * credential is a 401 that reads like a bad token.
 */
const CLI: Partial<Record<ForgeProvider, readonly CliCommand[]>> = {
  github: [{ argv: ['gh', 'auth', 'token'], hostFlag: '--hostname', output: 'bare' }],
  gitlab: [
    { argv: ['glab', 'config', 'get', 'token'], hostFlag: '--host', output: 'bare' },
    { argv: ['glab', 'auth', 'status', '--show-token'], hostFlag: '--hostname', output: 'report' },
  ],
};

/** One resolved token, and the source that supplied it. */
export interface ResolvedToken {
  token: string | null;
  /** `setting`, `environment`, `cli` or `none` — for the panel's own note. */
  source: 'setting' | 'environment' | 'cli' | 'none';
}

/** A CLI answer, cached per provider AND host for the life of the process. */
const cliCache = new Map<string, string | null>();

/**
 * The default runner: an argv spawn, never a shell string.
 *
 * **A missing binary THROWS from `Bun.spawnSync`** (`Executable not found in
 * $PATH`), and it is the ordinary case here — a machine without `gh` or `glab`
 * installed. Measured: the throw escaped `resolveToken` and failed the whole
 * read with "Executable not found in $PATH: glab", so a repository with a public
 * forge could not be browsed at all. A missing CLI is simply no answer.
 *
 * **stderr is part of the answer.** `glab auth status` writes its entire report
 * to stderr and nothing to stdout (measured on glab 1.126), so a runner that
 * keeps only stdout reads a logged-in machine as "no credential".
 */
function defaultRun(argv: string[]): { ok: boolean; stdout: string } {
  try {
    const result = Bun.spawnSync(argv, { stdout: 'pipe', stderr: 'pipe', timeout: 5_000 });
    const stdout = result.stdout ? result.stdout.toString() : '';
    const stderr = result.stderr ? result.stderr.toString() : '';
    return { ok: result.exitCode === 0, stdout: `${stdout}${stderr}` };
  } catch {
    return { ok: false, stdout: '' };
  }
}

/** Strip the ANSI colouring a CLI adds to a terminal. */
function plain(output: string): string {
  return output.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * The token in a CLI's output, or null.
 *
 * Two shapes, because two commands answer: `gh auth token` and
 * `glab config get token` print the bare token, while `glab auth status` prints
 * a report whose token line is `✓ Token found in configuration file
 * (plaintext): <token>` (an older spelling is `Token: <token>`). A MASKED value
 * is not a token — sending `******` would be a credential the host rejects with
 * a 401 that reads like a bad token.
 */
function tokenFromOutput(output: string, mode: CliCommand['output']): string | null {
  const text = plain(output).trim();
  if (!text) return null;

  if (mode === 'bare') {
    // One line, no spaces: a command that answers a bare token prints exactly
    // that, and anything else (a warning, an error sentence) is not a credential.
    return /^\S+$/.test(text) ? text : null;
  }

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/Token(?:\s+found[^:]*)?:\s*(\S+)/i);
    if (!match) continue;
    const value = match[1].trim();
    if (!value || /^\*+$/.test(value)) continue;
    return value;
  }
  return null;
}

/**
 * The CLI's answer, or null.
 *
 * Every call is scoped to the repository's own host. `glab auth status` reports
 * EVERY configured instance, so a host-less read can hand this repository a
 * token stored for a different GitLab — and the failure is a 401 that looks like
 * a bad token rather than a token for the wrong server.
 *
 * **The exit code is not the answer.** `glab auth status` exits non-zero when it
 * finds a token the host rejects, and when another configured host is logged
 * out; it still prints the token it found. The parsed output decides, and a
 * rejected token is then reported by the host's own 401 — a more accurate
 * sentence than "no credential".
 */
function fromCli(
  provider: ForgeProvider,
  host: string | undefined,
  run: (argv: string[]) => { ok: boolean; stdout: string },
): string | null {
  const commands = CLI[provider];
  if (!commands) return null;
  const key = `${provider}\u0000${host ?? ''}`;
  if (cliCache.has(key)) return cliCache.get(key) ?? null;

  let token: string | null = null;
  for (const command of commands) {
    const argv = host ? [...command.argv, command.hostFlag, host] : [...command.argv];
    token = tokenFromOutput(run(argv).stdout, command.output);
    if (token) break;
  }
  cliCache.set(key, token);
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

  const host = (sources.host ?? '').trim();
  const token = fromCli(provider, host || undefined, sources.run ?? defaultRun);
  return token ? { token, source: 'cli' } : { token: null, source: 'none' };
}
