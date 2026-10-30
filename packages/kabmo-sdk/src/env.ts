/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The environment variables Kabmo HOST owns, and the rule for removing
 * them before a process of the user's is started.
 *
 * The host's own variables are NOT configuration for the project it is running.
 * They describe the listener this server holds (`PORT`, and `NODE_ENV`, which
 * decides dev vs production for THIS package) and its own credential. A child
 * that inherits them misreads them as its own: measured, a `bun run dev` started
 * from the Runner panel under a Kabmo serving 3001 inherited `PORT=3001` and
 * refused to boot ("Port 3001 is already served by Kabmo"), and inherited
 * `NODE_ENV=production` and would have come up in production mode — while the
 * same command in a plain terminal, where `PORT` is unset, ran on 3000.
 *
 * This lives in the SDK rather than in each caller because the two sides that
 * need it cannot share Kabmo source: the host's omp-child spawner and a
 * plugin's own `Bun.spawn` both start a process of the user's, and a second copy
 * of the list is exactly how the two drift apart.
 *
 * `NEXT_` is a PREFIX rather than a name because it is not one variable: it is
 * Next.js's whole namespace of build-time-inlined values, which is meaningless to
 * any process other than the Next build that wrote it.
 */

/** The host's own variables, by exact name. */
export const KABMO_HOST_ENV_NAMES: readonly string[] = [
  /** The port THIS Kabmo listens on. */
  'PORT',
  /**
   * The bind address THIS Kabmo listens on — the CLI sets it beside `PORT`
   * (`buildServeInvocation`, from `--lan`/`--host`/`KABMO_HOST`), so a
   * project command that inherits it binds to Kabmo's own address instead
   * of the one its script chose. Measured: a run from the Runner panel under a
   * Kabmo started with `HOST=127.0.0.1` reported `HOST=127.0.0.1` while a plain
   * terminal had it unset. `bun run dev:lan` is the visible case — its own
   * `HOST=0.0.0.0` prefix is a plain shell assignment and still wins, but a
   * script that only sets `PORT` (or reads `HOST` as a default) inherited the
   * wrong one, and `HOST` is not a variable any project owns.
   */
  'HOST',
  /** `production` for a Kabmo serving its AOT bundle, which is not the mode a
   *  project's own `dev` script is asking for. */
  'NODE_ENV',
  /** The Kabmo's UI credential. Never a value a project command needs. */
  'KABMO_UI_PASSWORD',
];

/** Namespaces the host owns wholesale, by prefix. */
export const KABMO_HOST_ENV_PREFIXES: readonly string[] = ['NEXT_'];

/**
 * Install directories a GUI- or launchd-started process does not have on PATH.
 *
 * The other half of the same problem, and the one that makes every toolchain
 * command fail: a macOS app launched from Finder, a LaunchAgent, and the
 * `--launch-mode=daemon` server they start all inherit launchd's own PATH
 * (`/usr/bin:/bin:/usr/sbin:/sbin`), not the user's login shell PATH. Measured
 * on this machine: a Command Runner run of `bun run dev` under that server
 * answered `Executable not found in $PATH: "bun"` — the same command in a
 * terminal, whose `~/.bun/bin` IS on PATH, ran fine. The terminal panel is
 * unaffected because it launches a LOGIN shell (`-i -l`), which re-reads the
 * user's profile; a plugin's `Bun.spawn` has no profile to read.
 *
 * So a child of the host is given these AFTER the inherited PATH, never before:
 * the user's own ordering (a version manager's shim, a project's `.bin`) must
 * keep winning, and this only fills in what a GUI launch never had.
 */
export const KABMO_TOOLCHAIN_PATH_DIRS: readonly string[] = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

/** Home-relative install directories, as POSIX suffixes of `$HOME`. */
export const KABMO_TOOLCHAIN_HOME_DIRS: readonly string[] = ['.bun/bin', '.local/bin', '.cargo/bin'];

/**
 * The directories `withToolchainPath` adds, in the order it adds them.
 *
 * `$HOME` comes from the SAME env the child will receive rather than from
 * `os.homedir()`: this module is reachable from a plugin's app bundle (where no
 * `process` exists), and a child env that already carries a `HOME` is the one
 * whose paths a probe can actually test.
 */
export function toolchainPathDirs(
  env: Record<string, string | undefined>,
  platform: string,
): string[] {
  // Windows resolves a bare executable through the user's environment, which a
  // GUI launch inherits; there is no launchd-style minimal PATH to repair.
  if (platform === 'win32') return [];
  const home = env.HOME?.trim();
  const fromHome = home ? KABMO_TOOLCHAIN_HOME_DIRS.map((suffix) => `${home}/${suffix}`) : [];
  return [...fromHome, ...KABMO_TOOLCHAIN_PATH_DIRS];
}

/**
 * A copy of `env` whose `PATH` also names the usual toolchain directories.
 *
 * The twin of `stripKabmoHostEnv`, applied to the same child environment and for
 * the same reason: the host's environment is not the user's shell. One REMOVES
 * what belongs to Kabmo; this ADDS what a launchd/GUI start never had, so a
 * command that runs in the user's terminal also runs from a plugin.
 *
 * Idempotent, and the inherited entries keep their order and precedence — an
 * entry already present is not appended twice. A missing `PATH` becomes exactly
 * the fallback list rather than an empty search path.
 */
export function withToolchainPath(
  env: Record<string, string | undefined>,
  platform: string,
): Record<string, string | undefined> {
  const copy = { ...env };
  if (platform === 'win32') return copy;
  const separator = ':';
  const merged = (copy.PATH ?? '').split(separator).filter((entry) => entry.length > 0);
  for (const dir of toolchainPathDirs(copy, platform)) {
    if (!merged.includes(dir)) merged.push(dir);
  }
  copy.PATH = merged.join(separator);
  return copy;
}

/**
 * A copy of `env` with the host's own variables removed.
 *
 * A copy, never a mutation: the caller's environment (Kabmo's own
 * `Bun.env`) must survive a spawn, and `Bun.spawn` with an explicit `env`
 * replaces the child's environment wholesale — so this is what the child gets,
 * not a patch applied to it.
 *
 * `platform` is passed in rather than read from `process`: this module is
 * reachable from a plugin's APP bundle, where no `process` exists, and Windows
 * env names are case-insensitive so `port` and `PORT` are the same variable
 * there.
 */
export function stripKabmoHostEnv(
  env: Record<string, string | undefined>,
  platform: string,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(env)) {
    const comparable = platform === 'win32' ? name.toUpperCase() : name;
    const owned = KABMO_HOST_ENV_NAMES.includes(comparable)
      || KABMO_HOST_ENV_PREFIXES.some((prefix) => comparable.startsWith(prefix));
    if (!owned) out[name] = value;
  }
  return out;
}

/**
 * @deprecated Use `stripKabmoHostEnv`.
 *
 * The old name is kept as a value alias rather than a second implementation, so
 * a host call site written against the previous release keeps the CURRENT
 * variable list. Two lists would be how `HOST` went missing from one of them.
 */
export const stripChamberHostEnv = stripKabmoHostEnv;

/** @deprecated Use `KABMO_HOST_ENV_NAMES`. */
export const CHAMBER_HOST_ENV_NAMES = KABMO_HOST_ENV_NAMES;

/** @deprecated Use `KABMO_HOST_ENV_PREFIXES`. */
export const CHAMBER_HOST_ENV_PREFIXES = KABMO_HOST_ENV_PREFIXES;
