/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What `git clone` accepts, and the slug to name the clone's directory after.
 *
 * Two callers, one rule: the panel-plugin installer validates a URL before it
 * stages a clone, and the New Workspace modal disables its Clone button on the
 * same predicate — so the button's enabled state and the server's refusal can
 * never disagree. A per-caller copy is what that costs.
 *
 * The local forms (`/path`, `~/path`, `file://`) are allowed deliberately.
 * `git clone` treats them as first-class, and the chamber already gives the
 * user a real shell in the terminal panel — a local clone grants nothing that
 * was not already reachable, while making an offline clone and a test
 * repository work.
 */

/** True for a source `git clone` accepts. */
export function isGitUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;
  if (/^ssh:\/\/\S+$/i.test(trimmed)) return true;
  if (/^git@[^:/\s]+:\S+$/.test(trimmed)) return true;
  if (/^file:\/\/\S+$/i.test(trimmed)) return true;
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) return true;
  return false;
}

/**
 * The directory name a clone of `url` should take: the last path segment with
 * a `.git` suffix and any trailing slash stripped.
 *
 * This is what `git clone` itself would choose, so a clone into the active
 * directory lands where the user expects, and a plugin staged to a temp
 * directory reads as the repository it came from.
 */
export function repoSlug(url: string): string {
  const tail = url.replace(/[/\\]+$/, '').split(/[/:]/).pop() ?? '';
  return tail.replace(/\.git$/i, '').replace(/[^a-z0-9._-]/gi, '-');
}
