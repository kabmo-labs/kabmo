/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where Antigravity keeps its per-user state.
 *
 * One fact with three readers: the session-transcript scan, the generated-image
 * resolver and the local quota reader. The CLI's own `ANTIGRAVITY_HOME`
 * override is honoured because a user who moved the directory expects every
 * surface to follow it; without the helper each reader spelled the fallback
 * itself and a fourth one would have spelled it a little differently.
 *
 * Measured on this machine: `~/.gemini/antigravity-cli/` holds the CLI's
 * `cache/default_project_id.txt`, its `conversations/` SQLite store and its
 * `brain/` images, while `~/.gemini/antigravity/` is the IDE's.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/** The root both Antigravity installations write under (`~/.gemini` by default). */
export function antigravityHome(): string {
  const override = Bun.env.ANTIGRAVITY_HOME?.trim();
  return override || join(homedir(), '.gemini');
}
