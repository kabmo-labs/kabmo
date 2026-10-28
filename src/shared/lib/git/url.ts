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
 * `git clone` treats them as first-class, and Kabmo already gives the
 * user a real shell in the terminal panel — a local clone grants nothing that
 * was not already reachable, while making an offline clone and a test
 * repository work.
 */

/**
 * True for a REMOTE source `git clone` accepts.
 *
 * The distinction from {@link isGitUrl} is a local path: `git clone` takes
 * `/srv/repo` and `~/repo` too, and a marketplace catalog resolves those
 * against its own root — so only a scheme or the `git@host:path` form is a
 * remote here. Anything else is a directory, and a directory that escapes the
 * marketplace is refused rather than cloned.
 */
export function isRemoteGitUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;
  if (/^ssh:\/\/\S+$/i.test(trimmed)) return true;
  if (/^git@[^:/\s]+:\S+$/.test(trimmed)) return true;
  return /^file:\/\/\S+$/i.test(trimmed);
}

/** True for a source `git clone` accepts. */
export function isGitUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;
  if (/^ssh:\/\/\S+$/i.test(trimmed)) return true;
  if (/^git@[^:/\s]+:\S+$/.test(trimmed)) return true;
  if (/^file:\/\/\S+$/i.test(trimmed)) return true;
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) return true;
  // A drive-rooted Windows path is a local source too, and the whole point of
  // allowing local paths is that a clone from disk works. Without this the
  // New Workspace modal's Clone button could never enable on Windows and
  // `POST /api/folders/clone` answered `invalid_url` for a path the user had
  // just browsed to — measured on the first Windows run, where all four clone
  // route cases failed with 400 for a real repository in a temp directory.
  //
  // `C:relative` is drive-RELATIVE on Windows, not absolute, so a colon with no
  // separator after it is refused — the same distinction `isAbsolutePath` in the
  // CLI's own path helpers makes.
  if (/^[a-z]:[\\/]/i.test(trimmed)) return true;
  if (/^\\\\[^\\]+\\/.test(trimmed)) return true; // UNC: \\server\share
  return false;
}

/**
 * The directory name a clone of `url` should take: the last path segment with
 * a `.git` suffix and any trailing slash stripped.
 *
 * This is what `git clone` itself would choose, so a clone into the active
 * directory lands where the user expects, and a plugin staged to a temp
 * directory reads as the repository it came from.
 *
 * The drive letter is stripped FIRST, and that is not cosmetic: splitting on
 * `:` alone treats `C:` as a separator, so a Windows path's "last segment" was
 * the WHOLE path with every separator dashed — a clone of
 * `C:\…\omc-clone-test\origin` landed in `…/projects/-Users-RUNNER-1-…-origin`
 * instead of `…/projects/origin`. The `git@host:path` scp form keeps its colon,
 * which is why this is a prefix strip rather than dropping `:` from the split.
 */
export function repoSlug(url: string): string {
  const withoutDrive = url.replace(/^[a-z]:/i, '');
  // Normalise every separator to `/` before splitting. A Windows path arrives
  // with `\` (and, when it came from an escaped config value, with `\\`), so a
  // split on `[/:]` would treat the whole tail as one segment and the "last
  // segment" would be the entire path — the slug then became
  // `-Users-x-repo` instead of `repo`.
  const normalised = withoutDrive.replace(/\\/g, '/').replace(/\/+$/, '');
  // A URL with no path segment at all (`https://`) names nothing to clone into,
  // so it keeps the empty answer rather than a dashed scheme. `git@host:path`
  // is handled by the same rule because the colon is a separator only when a
  // path follows it.
  const segments = normalised.split(/[/:]/).filter(Boolean);
  const tail = segments.length === 0 ? '' : segments[segments.length - 1];
  if (tail === '' || /^[a-z]+:$/i.test(tail) || /^https?:?$/i.test(tail)) return '';
  return tail.replace(/\.git$/i, '').replace(/[^a-z0-9._-]/gi, '-');
}
