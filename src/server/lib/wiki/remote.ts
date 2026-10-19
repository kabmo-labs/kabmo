/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The git remote → the wiki repository behind it.
 *
 * Both GitHub and GitLab publish a project's wiki as a SEPARATE git repository
 * whose URL is the project's own with `.wiki.git` on the end, so Kabmo
 * needs no provider API, no token scope and no per-host branch: it appends the
 * suffix to whatever `origin` already is. That is also why a self-hosted GitLab
 * (`git-rbi.jatismobile.com/jns6_5/drrealhandler`) works with no code of its own
 * — verified against the real host, whose `drrealhandler.wiki.git` clones the
 * same pages its web UI shows.
 *
 * The suffix is appended to the remote VERBATIM, credentials and scheme
 * included, because the fetch has to authenticate the way the checkout does: a
 * self-hosted GitLab URL in this workspace carries its own basic-auth user, and
 * an SSH remote has to stay SSH. What travels back to the page is a separate,
 * credential-free URL — see `redactRemoteUrl`.
 */

/** A remote, split into what the fetch needs and what the reader may see. */
export interface ParsedWikiRemote {
  /** Host of the remote, port included when it has one (`github.com`). */
  host: string;
  /** `owner/name`, subgroups included, without `.git`. */
  slug: string;
  /** Credential-free `https://host/owner/name` of the PROJECT. */
  projectUrl: string;
  /** The wiki repository, in the remote's own scheme and with its own credentials. */
  wikiRemote: string;
}

/** `git@github.com:owner/name.git` — a scheme-less scp-style remote. */
const SCP_LIKE_RE = /^(?:[^@/]+@)?([^:/]+):(.+)$/;

function stripGitSuffix(value: string): string {
  return value.replace(/\/+$/, '').replace(/\.git$/i, '');
}

/**
 * Parse one git remote URL into its wiki parts, or null when it is not a URL a
 * wiki can hang off (a local path, an empty value, a bare host).
 *
 * Accepts the three shapes git itself accepts: `https://host/o/n.git`,
 * `ssh://git@host/o/n.git`, and `git@host:o/n.git`.
 */
export function parseWikiRemote(rawRemote: string | null | undefined): ParsedWikiRemote | null {
  const raw = (rawRemote ?? '').trim();
  if (!raw || raw.includes('://') === false && !SCP_LIKE_RE.test(raw)) return null;

  let host: string;
  let pathPart: string;
  let scheme = 'https';

  const scp = raw.includes('://') ? null : raw.match(SCP_LIKE_RE);
  if (scp) {
    host = scp[1];
    pathPart = scp[2];
  } else {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    // `new URL` lower-cases the host and drops the default port, so the same
    // remote spelled two ways keys one cache entry.
    host = url.host;
    scheme = url.protocol === 'http:' ? 'http' : 'https';
    pathPart = url.pathname;
  }

  const slug = stripGitSuffix(pathPart.replace(/^\/+/, ''));
  // A wiki needs an owner and a project; a local path or a bare host is not one.
  if (!host || slug.split('/').filter(Boolean).length < 2) return null;

  return {
    host,
    slug,
    projectUrl: `${scheme}://${host}/${slug}`,
    wikiRemote: `${stripGitSuffix(raw)}.wiki.git`,
  };
}

/**
 * The credential-free form of a remote, for anything that leaves the server.
 *
 * `https://user:token@host/o/n.git` is how a self-hosted GitLab authenticates
 * from this workspace, and echoing it back would put a secret in the DOM, the
 * devtools network tab and any screenshot of the panel.
 */
export function redactRemoteUrl(rawRemote: string): string {
  return rawRemote.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1');
}

/** The wiki's web page, per provider. Null when the host is not recognised. */
export function wikiWebUrl(provider: 'github' | 'gitlab' | 'other', host: string, slug: string): string | null {
  if (provider === 'github') return `https://${host}/${slug}/wiki`;
  if (provider === 'gitlab') return `https://${host}/${slug}/-/wikis/home`;
  return null;
}
