/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `origin` remote → the API this plugin talks to.
 *
 * The remote is the ONLY input, and that is the design: a repository already
 * says where it lives, so asking the user to configure a host per workspace
 * would be a second answer to a question the checkout has already answered. The
 * wiki panel makes the same bet with `.wiki.git` appended; this one reads the
 * same URL and derives an API root from it.
 *
 * Five rules are load-bearing:
 *
 * - **Credentials are stripped.** A self-hosted GitLab remote is routinely
 *   `https://user:token@host/o/n.git`, and echoing that back would put a secret
 *   in the DOM and in every screenshot of the panel.
 * - **The provider is a GUESS, and a setting overrides it.** The host's NAME is
 *   the only signal a remote carries, so `github.com` and any host containing
 *   `github` is GitHub, `gitea`/`forgejo`/`codeberg` is Gitea, `bitbucket` is
 *   Bitbucket, and everything else is GitLab — a self-hosted GitLab being the
 *   common non-GitHub case.
 * - **A local path is not a remote.** `/srv/repo` and `C:\repo` parse as
 *   nothing, because there is no API behind them.
 * - **The scheme survives.** A remote over plain `http` (a lab box, a tunnel)
 *   must reach an API over `http` too, or every read fails on TLS.
 * - **Bitbucket is the one host whose API is not on the same hostname.** Its
 *   Cloud API lives at `api.bitbucket.org/2.0` while the repository page is at
 *   `bitbucket.org`, so the API root cannot be derived from the remote's host.
 */

import type { ForgeProvider } from '../protocol';

/** The preference a setting carries. */
export type ProviderPreference = 'auto' | ForgeProvider;

export interface ForgeRemote {
  provider: ForgeProvider;
  /** Host, port included when the remote has one (`localhost:3000`). */
  host: string;
  /** `owner/name`, subgroups included, without `.git`. */
  slug: string;
  /** The project's page on the host, always https unless the remote was http. */
  webUrl: string;
  /** The API root every request is built on. */
  apiBase: string;
}

export interface RemoteOptions {
  provider?: ProviderPreference;
  /** A setting that overrides the derived API root. */
  apiBase?: string;
}

/** `git@host:owner/name.git` — the scheme-less scp form. */
const SCP_LIKE = /^(?:[^@/]+@)?([^:/]+):(.+)$/;

/** A drive-rooted path is local, not `host:path`. */
const WINDOWS_PATH = /^[a-z]:[\\/]/i;

interface SplitRemote {
  host: string;
  path: string;
  scheme: 'http' | 'https';
}

function splitRemote(raw: string): SplitRemote | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (WINDOWS_PATH.test(trimmed)) return null;

  if (trimmed.includes('://')) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    // `url.host` already excludes userinfo, which is what keeps a credential out
    // of every later string.
    if (!url.host) return null;
    return { host: url.host, path: url.pathname, scheme: url.protocol === 'http:' ? 'http' : 'https' };
  }

  const scp = trimmed.match(SCP_LIKE);
  if (!scp) return null;
  return { host: scp[1], path: scp[2], scheme: 'https' };
}

/**
 * The provider a host's name implies.
 *
 * Ordered, because one name can contain another: `gitbucket.example` is not
 * Bitbucket, so the specific names are tested before the general ones and
 * Bitbucket matches only its own host.
 */
export function providerForHost(host: string): ForgeProvider {
  const name = host.toLowerCase();
  if (name === 'github.com' || name.includes('github')) return 'github';
  if (name === 'bitbucket.org' || name.startsWith('bitbucket.')) return 'bitbucket';
  if (name.includes('gitea') || name.includes('forgejo') || name.includes('codeberg')) return 'gitea';
  return 'gitlab';
}

/**
 * Parse one remote into its API parts, or a sentence explaining why it cannot be
 * one.
 */
export function parseRemote(
  raw: string | null | undefined,
  options: RemoteOptions = {},
): ForgeRemote | { error: string } {
  const value = (raw ?? '').trim();
  if (!value) return { error: 'This repository has no origin remote, so there is no forge to read.' };

  const split = splitRemote(value);
  if (!split) {
    return {
      error: `The origin remote (${value}) is a local path, so it has no forge behind it. Point origin at a GitHub, GitLab, Gitea or Bitbucket repository.`,
    };
  }

  const slug = split.path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  if (slug.split('/').filter(Boolean).length < 2) {
    return { error: `The origin remote (${value}) does not name an owner and a repository.` };
  }

  const provider: ForgeProvider =
    options.provider === 'github' ||
    options.provider === 'gitlab' ||
    options.provider === 'gitea' ||
    options.provider === 'bitbucket'
      ? options.provider
      : providerForHost(split.host);

  return {
    provider,
    host: split.host,
    slug,
    webUrl: `${split.scheme}://${split.host}/${slug}`,
    apiBase: apiBaseFor(provider, split.host, split.scheme, options.apiBase),
  };
}

/**
 * The API root for a provider and host.
 *
 * GitHub is the one host with a DIFFERENT path per deployment: github.com serves
 * `/`, Enterprise serves `/api/v3`. GitLab serves `/api/v4` everywhere, Gitea
 * `/api/v1` everywhere, and Bitbucket Cloud is not on the repository's hostname
 * at all — which is why it takes no host.
 */
export function apiBaseFor(
  provider: ForgeProvider,
  host: string,
  scheme: 'http' | 'https',
  override?: string,
): string {
  const given = (override ?? '').trim().replace(/\/+$/, '');
  if (given) return given;
  if (provider === 'bitbucket') return 'https://api.bitbucket.org/2.0';
  if (provider === 'gitlab') return `${scheme}://${host}/api/v4`;
  if (provider === 'gitea') return `${scheme}://${host}/api/v1`;
  return host.toLowerCase() === 'github.com' ? 'https://api.github.com' : `${scheme}://${host}/api/v3`;
}

/** The URL-encoded project path GitLab takes where GitHub takes `owner/name`. */
export function gitlabProject(slug: string): string {
  return encodeURIComponent(slug);
}

/**
 * Bitbucket addresses a repository as two path segments, so its slug is split.
 *
 * Null when the slug is not exactly `workspace/repo`: a nested path is a GitLab
 * subgroup, and Bitbucket has no such thing — guessing which segment is the
 * repository would read the wrong project.
 */
export function bitbucketPath(slug: string): { workspace: string; repo: string } | null {
  const parts = slug.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  return { workspace: parts[0], repo: parts[1] };
}
