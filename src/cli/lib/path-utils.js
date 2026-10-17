// Minimal path helpers for the CLI — Bun has no path builtin (Bun.path is
// undefined), and the CLI only needs POSIX-style join/resolve/dirname on
// absolute native paths.
//
// Every helper speaks BOTH separators, because the CLI runs on Windows. A path
// there arrives as `C:\Users\...\ompchamber\src\cli` (import.meta.dir, argv, an
// env override), and a resolver that recognized only a leading `/` treated it
// as RELATIVE: it prefixed the cwd and `resolvePath(import.meta.dir, '..', '..')`
// answered `C:\/C:\/C:\Users\...\src\cli/../..`, so the package root and every
// path derived from it pointed nowhere — `ompchamber serve` reported "This
// install is incomplete" for a tarball that ships `dist/client`. Verified
// against the published install.

import { homedir } from 'node:os';

/** `C:\x` / `C:/x` — a Windows drive-rooted path. */
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
/** `\\server\share` — a Windows UNC path (also spelled `//server/share`). */
const WINDOWS_UNC = /^[\\/]{2}[^\\/]/;

/**
 * Whether a path is absolute.
 *
 * Both platforms' spellings are recognized on either platform: the CLI's paths
 * come from the OS (a Windows path IS absolute on Windows) and from user input,
 * and an absolute argument must discard what precedes it exactly as `/tmp/x`
 * does — otherwise `ompchamber plugin new C:\proj` scaffolds into `<cwd>/C:\proj`.
 */
export function isAbsolutePath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  return value.startsWith('/') || WINDOWS_DRIVE.test(value) || WINDOWS_UNC.test(value);
}

/** Forward-slash spelling: the form every helper here does its string work in. */
function toPosix(value) {
  return value.replace(/\\/g, '/');
}

/** Collapse duplicate separators without mangling a UNC prefix (`//server`). */
function collapseSlashes(value) {
  const unc = value.startsWith('//');
  const collapsed = value.replace(/\/{2,}/g, '/');
  return unc ? `/${collapsed}` : collapsed;
}

/** Join path segments with the platform separator without duplicated separators. */
export function joinPath(...segments) {
  let joined = '';
  for (const segment of segments) {
    if (!segment) continue;
    const part = toPosix(segment);
    if (!joined) {
      joined = part;
    } else if (joined.endsWith('/') || part.startsWith('/')) {
      joined = `${joined.replace(/\/+$/, '')}/${part.replace(/^\/+/, '')}`;
    } else {
      joined = `${joined}/${part}`;
    }
  }
  return joined;
}

/**
 * Resolve a path to an absolute normalized path.
 *
 * Node's `path.resolve` semantics on the two points that matter here:
 *
 * - An ABSOLUTE segment discards everything before it. `joinPath` deliberately
 *   strips a leading slash (it is used to build a path FROM a root), so
 *   `joinPath(cwd, '/tmp/x')` yields `<cwd>/tmp/x` — a silent relocation of an
 *   absolute argument. Verified on the CLI: `ompchamber plugin new /tmp/x`
 *   scaffolded into `<cwd>/tmp/x`. On Windows the same rule applies to a
 *   drive-rooted or UNC argument.
 * - A `.` segment means "here", so it contributes nothing. Without this,
 *   `resolvePath(cwd, '.')` answered `<cwd>/.` — a path that works but is not
 *   the string a caller compares against.
 */
export function resolvePath(...segments) {
  let lastAbsolute = -1;
  for (let i = 0; i < segments.length; i += 1) {
    if (isAbsolutePath(segments[i])) lastAbsolute = i;
  }
  const parts = (lastAbsolute === -1 ? [process.cwd(), ...segments] : segments.slice(lastAbsolute))
    .filter((segment) => typeof segment === 'string' && segment.length > 0 && segment !== '.')
    .map(toPosix);
  const joined = (parts.length > 0 && isAbsolutePath(parts[0]) ? parts : [toPosix(process.cwd()), ...parts]).join('/');
  return collapseSlashes(joined).replace(/(.+)\/$/, '$1');
}

/**
 * Current user home directory. Uses `os.homedir()` rather than `Bun.env.HOME`
 * because the env var is absent when the CLI runs without a shell (cron,
 * launchd, GUI launcher) — there it would yield '' and make every derived data
 * path relative to the cwd, so `stop`/`status` would look in the wrong place.
 * `os.homedir()` falls back to getpwuid on POSIX and USERPROFILE on Windows.
 */
export function homeDir() {
  return homedir();
}
