// Minimal path helpers for the CLI — Bun has no path builtin (Bun.path is
// undefined), and the CLI only needs POSIX-style join/resolve/dirname on
// absolute native paths.

import { homedir } from 'node:os';

/** Join path segments with the platform separator without duplicated separators. */
export function joinPath(...segments) {
  let joined = '';
  for (const segment of segments) {
    if (!segment) continue;
    if (!joined) {
      joined = segment;
    } else if (joined.endsWith('/') || segment.startsWith('/')) {
      joined = `${joined.replace(/\/+$/, '')}/${segment.replace(/^\/+/, '')}`;
    } else {
      joined = `${joined}/${segment}`;
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
 *   scaffolded into `<cwd>/tmp/x`.
 * - A `.` segment means "here", so it contributes nothing. Without this,
 *   `resolvePath(cwd, '.')` answered `<cwd>/.` — a path that works but is not
 *   the string a caller compares against.
 */
export function resolvePath(...segments) {
  let lastAbsolute = -1;
  for (let i = 0; i < segments.length; i += 1) {
    if (typeof segments[i] === 'string' && segments[i].startsWith('/')) lastAbsolute = i;
  }
  const parts = (lastAbsolute === -1 ? [process.cwd(), ...segments] : segments.slice(lastAbsolute)).filter(
    (segment) => typeof segment === 'string' && segment.length > 0 && segment !== '.',
  );
  const joined = (parts.length > 0 && parts[0].startsWith('/') ? parts : [process.cwd(), ...parts]).join('/');
  return joined.replace(/\/{2,}/g, '/').replace(/(.+)\/$/, '$1');
}

/** Directory portion of an absolute path ('/' for the root). */
export function dirnameOf(value) {
  const index = value.lastIndexOf('/');
  if (index <= 0) return '/';
  return value.slice(0, index);
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
