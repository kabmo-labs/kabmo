/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two worktree setting keys, in a module with NO server imports.
 *
 * The server reads them from `kabmo_settings` (`lib/fs/worktree/settings.server.ts`)
 * and the settings panel writes them through `writeSetting`; both sides need the
 * same strings, and the client bundle must not pull in `@/db.server` to get them.
 */

/** Parent directory new worktrees are created in; empty means the default. */
export const WORKTREE_DIRECTORY_SETTING = 'worktreeDirectory';

/** Whether a create copies the project's ignored build folders. Default: on. */
export const WORKTREE_CARRY_SETTING = 'worktreeCarryIgnored';