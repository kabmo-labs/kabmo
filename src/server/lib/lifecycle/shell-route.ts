/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where the HTML shell lives in Bun's routing table.
 *
 * One constant for both ends: the server registers the bundle on this path and
 * `plugins/shell.server.ts` fetches it back. Kept apart from either so the two
 * cannot drift — a rename on one side alone would 404 the shell route and every
 * page would answer 503.
 *
 * Underscored and unlinked: nothing serves a user-facing page from here, and a
 * name outside the app's own paths cannot collide with a client route.
 */
export const SHELL_ROUTE = '/_shell';
