/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The remote, read as a host and a repository path.
 *
 * Four spellings reach a checkout — `https://`, `ssh://`, the `git@host:path`
 * shorthand, and a credential-bearing URL — and every one of them has to answer
 * the same two facts. A local path (or a remote this build cannot read) answers
 * null, which the caller reports as "this checkout has no forge remote" rather
 * than as an empty run list.
 *
 * **Only GitHub is addressable here.** Actions is GitHub's vocabulary; a GitLab
 * remote is refused by name instead of being read against `api.github.com` and
 * reported as a repository that does not exist.
 */

export interface Remote {
  /** `github.com`, or the enterprise host. */
  host: string;
  /** `owner/name`, the path the REST API takes. */
  slug: string;
  /** The page a reader would open. */
  webUrl: string;
  /** The REST root, honouring a GitHub Enterprise `/api/v3` suffix. */
  apiBase: string;
}

/** Whether a host is GitHub itself, or an enterprise install of it. */
export function isGithubHost(host: string): boolean {
  const lowered = host.toLowerCase();
  return lowered === 'github.com' || lowered.includes('github');
}

/** Split a remote URL into host and path, or null when it is not one. */
function splitRemote(raw: string): { host: string; path: string } | null {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  // `git@host:owner/repo.git` — the scp shorthand, which is not a URL.
  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(trimmed);
  if (scp && !trimmed.includes('://')) {
    return { host: scp[1]!, path: scp[2]! };
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'file:') return null;
    return { host: url.hostname, path: url.pathname.replace(/^\/+/, '') };
  } catch {
    return null;
  }
}

/** The API root a host serves, with an explicit override winning. */
export function apiBaseFor(host: string, override: string | null): string {
  const stated = (override ?? '').trim().replace(/\/+$/, '');
  if (stated) return stated;
  // github.com serves its REST API on a different hostname; an enterprise
  // install serves it under `/api/v3` on its own host. Getting this wrong is a
  // 404 that reads as "the repository is private or renamed" — measured while
  // wiring this plugin: `https://github.com/repos/...` answered 404.
  return host.toLowerCase() === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
}

/**
 * Read a remote URL.
 *
 * The path is kept whole (`owner/name`, and for an unusual host whatever it
 * serves) because guessing a segment count would break the first install that
 * serves repositories one level deeper.
 */
export function parseRemote(raw: string, apiOverride: string | null = null): Remote | null {
  const split = splitRemote(raw);
  if (!split) return null;
  const path = split.path.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  if (!path || !path.includes('/')) return null;
  return {
    host: split.host,
    slug: path,
    webUrl: `https://${split.host}/${path}`,
    apiBase: apiBaseFor(split.host, apiOverride),
  };
}
