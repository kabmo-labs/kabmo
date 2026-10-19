/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The environment variables the CHAMBER HOST owns, and the rule for removing
 * them before a process of the user's is started.
 *
 * The host's own variables are NOT configuration for the project it is running.
 * They describe the listener this server holds (`PORT`, and `NODE_ENV`, which
 * decides dev vs production for THIS package) and its own credential. A child
 * that inherits them misreads them as its own: measured, a `bun run dev` started
 * from the Runner panel under a chamber serving 3001 inherited `PORT=3001` and
 * refused to boot ("Port 3001 is already served by Kabmo"), and inherited
 * `NODE_ENV=production` and would have come up in production mode — while the
 * same command in a plain terminal, where `PORT` is unset, ran on 3000.
 *
 * This lives in the SDK rather than in each caller because the two sides that
 * need it cannot share chamber source: the host's omp-child spawner and a
 * plugin's own `Bun.spawn` both start a process of the user's, and a second copy
 * of the list is exactly how the two drift apart.
 *
 * `NEXT_` is a PREFIX rather than a name because it is not one variable: it is
 * Next.js's whole namespace of build-time-inlined values, which is meaningless to
 * any process other than the Next build that wrote it.
 */

/** The host's own variables, by exact name. */
export const CHAMBER_HOST_ENV_NAMES: readonly string[] = [
  /** The port THIS chamber listens on. */
  'PORT',
  /**
   * The bind address THIS chamber listens on — the CLI sets it beside `PORT`
   * (`buildServeInvocation`, from `--lan`/`--host`/`OMPCHAMBER_HOST`), so a
   * project command that inherits it binds to the chamber's own address instead
   * of the one its script chose. Measured: a run from the Runner panel under a
   * chamber started with `HOST=127.0.0.1` reported `HOST=127.0.0.1` while a plain
   * terminal had it unset. `bun run dev:lan` is the visible case — its own
   * `HOST=0.0.0.0` prefix is a plain shell assignment and still wins, but a
   * script that only sets `PORT` (or reads `HOST` as a default) inherited the
   * wrong one, and `HOST` is not a variable any project owns.
   */
  'HOST',
  /** `production` for a chamber serving its AOT bundle, which is not the mode a
   *  project's own `dev` script is asking for. */
  'NODE_ENV',
  /** The chamber's UI credential. Never a value a project command needs. */
  'OMPCHAMBER_UI_PASSWORD',
];

/** Namespaces the host owns wholesale, by prefix. */
export const CHAMBER_HOST_ENV_PREFIXES: readonly string[] = ['NEXT_'];

/**
 * A copy of `env` with the host's own variables removed.
 *
 * A copy, never a mutation: the caller's environment (the chamber's own
 * `Bun.env`) must survive a spawn, and `Bun.spawn` with an explicit `env`
 * replaces the child's environment wholesale — so this is what the child gets,
 * not a patch applied to it.
 *
 * `platform` is passed in rather than read from `process`: this module is
 * reachable from a plugin's APP bundle, where no `process` exists, and Windows
 * env names are case-insensitive so `port` and `PORT` are the same variable
 * there.
 */
export function stripChamberHostEnv(
  env: Record<string, string | undefined>,
  platform: string,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(env)) {
    const comparable = platform === 'win32' ? name.toUpperCase() : name;
    const owned = CHAMBER_HOST_ENV_NAMES.includes(comparable)
      || CHAMBER_HOST_ENV_PREFIXES.some((prefix) => comparable.startsWith(prefix));
    if (!owned) out[name] = value;
  }
  return out;
}
