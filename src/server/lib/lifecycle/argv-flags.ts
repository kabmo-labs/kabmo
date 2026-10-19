/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * argv flags the SERVER reads for itself.
 *
 * argv rather than env for both, for the reason `lifecycle/launch-mode.ts`
 * records: env is inherited by every descendant, so a `bun run dev` started
 * inside Kabmo's own terminal would silently inherit the choice. The CLI
 * appends these to the invocation it spawns, and a login entry spells the same
 * argv for itself.
 */

/**
 * Raise the tray icon for this run (`serve --tray`).
 *
 * Paired with the CLI's own `--tray`, and carried into a login entry's argv by
 * `tray/entry.ts` — one spelling for the writer and the reader, exactly as
 * `launchModeArg`/`resolveLaunchMode` do it.
 */
export const TRAY_FLAG = '--tray';

/**
 * The credential FILE a login entry points at (`serve --ui-password-file <path>`).
 *
 * A path rather than the secret: the entry itself (a plist, a `.desktop` file, a
 * Run value) is world-readable and outlives the run that wrote it, while the
 * file it names lives in the data directory at mode 0600.
 */
export const UI_PASSWORD_FILE_FLAG = '--ui-password-file';

export function isTrayEnabledByArgv(argv: readonly string[] = Bun.argv): boolean {
  return argv.includes(TRAY_FLAG);
}

/**
 * Run in production mode.
 *
 * The server has always taken its mode from `NODE_ENV`, which the CLI sets when
 * it spawns one. `--prod` exists so a login entry's argv states the mode too —
 * it is the CLI's flag as much as the server's, and the entry pins it so the
 * registration reads as a complete invocation rather than depending on the
 * environment a shell would have exported.
 */
export const PROD_FLAG = '--prod';
