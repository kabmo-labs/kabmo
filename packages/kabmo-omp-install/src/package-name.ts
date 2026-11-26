/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The npm package an omp install comes from.
 *
 * Named here, in the dependency-free module, because three callers need it and
 * none of them may import the update check: the install hint prints it, the
 * startup error names it, and the registry read asks for it. `updates/npm.ts`
 * re-exports it so its own callers keep their import.
 */
export const OMP_PACKAGE = '@oh-my-pi/pi-coding-agent';
