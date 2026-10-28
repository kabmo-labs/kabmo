/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Ambient declarations for the oh-my-pi modules the mode extension imports.
 *
 * The extension runs INSIDE an omp child process, where `@oh-my-pi/pi-coding-agent`
 * resolves from omp's own install — but Kabmo's `tsc` runs in Kabmo
 * checkout, where that package is not a dependency and its `exports` map is
 * therefore unresolvable. Declaring the two members actually used keeps
 * `bun run lint` honest about the extension's own code without making the
 * Kabmo's typecheck depend on a globally-installed package (a machine-specific
 * `paths` entry pointing at the global install would break on every other
 * machine, including CI).
 *
 * Only the surface this directory touches is declared. Adding a member here is
 * the deliberate act of depending on one more piece of omp's internals.
 */

declare module '@oh-my-pi/pi-coding-agent/internal-urls' {
  /** omp's `local://` root for a session: `<artifactsDir>/local` when the
   *  session exposes an artifacts dir, else a temp directory keyed by session
   *  id. Verified against omp 18.4.4. */
  export function resolveLocalRoot(options: unknown): string;
}
