/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The naming rule for a Kabmo plugin repository published on GitHub.
 *
 * A plugin's own identity (its manifest `id`, the name the pane shows and the
 * directory it installs into) is free-form. Its REPOSITORY is not: an external
 * GitHub repository that publishes a Kabmo plugin must be named
 * `kabmo-plugins-<plugin>`, so the ecosystem is discoverable by one search and
 * two unrelated plugins cannot squat the same repository name. The prefix is
 * stripped when the catalog derives the plugin's name, which is why installing
 * a plugin never needs the prefix in its own name.
 *
 * Only GitHub is checked. A self-hosted forge has no naming authority to
 * enforce, and a local path is a development source rather than a published
 * plugin. The check runs in three places against this one function: the git
 * install, the catalog parser, and the registration action — so a repository
 * cannot enter by any of them under a name the others refuse.
 */

import { isGitUrl } from '@/shared/lib/git/url';

/** The prefix every external GitHub plugin repository carries. */
export const KABMO_PLUGIN_REPO_PREFIX = 'kabmo-plugins-';

export interface GithubPluginRepo {
  owner: string;
  repo: string;
}

function githubRepo(host: string, segments: readonly string[]): GithubPluginRepo | null {
  if (!/^(?:www\.)?github\.com$/i.test(host)) return null;
  if (segments.length < 2) return null;
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');
  if (!owner || !repo) return null;
  return { owner, repo };
}

/**
 * The GitHub `owner/repo` a URL names, or null when it is not a GitHub URL.
 *
 * Parsed rather than pattern-matched because the two spellings git accepts —
 * the URL form and the `git@host:owner/repo` scp form — put the path in
 * different places, and a URL may carry a trailing path (`/tree/main`), a
 * trailing slash or a port. All of those still name the same repository, and a
 * check that missed one would be a way past the rule.
 */
export function parseGithubPluginRepo(value: string): GithubPluginRepo | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const scp = /^git@([^:/\s]+):(.+)$/.exec(trimmed);
  if (scp) return githubRepo(scp[1], scp[2].split('/').filter(Boolean));

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:' && parsed.protocol !== 'ssh:') return null;
  return githubRepo(parsed.hostname, parsed.pathname.split('/').filter(Boolean));
}

/**
 * Why `url` is not an acceptable GitHub plugin repository, or null when it is.
 *
 * A non-GitHub URL is accepted: the rule is about the naming convention GitHub
 * repositories follow, and refusing every other forge would make a GitLab or a
 * local mirror uninstallable.
 */
export function pluginRepoNameError(url: string): string | null {
  const repo = parseGithubPluginRepo(url);
  if (!repo) return null;
  if (repo.repo.toLowerCase().startsWith(KABMO_PLUGIN_REPO_PREFIX)) return null;
  return (
    `GitHub plugin repositories must be named "${KABMO_PLUGIN_REPO_PREFIX}<plugin>"; ` +
    `"${repo.owner}/${repo.repo}" is not. The plugin's own name does not need the prefix.`
  );
}

/**
 * The plugin name a repository name publishes: `kabmo-plugins-kanban` → `kanban`.
 *
 * Lowercased because the name becomes a catalog key and is compared against a
 * manifest id, which is conventionally lowercase. Null when the URL is not a
 * GitHub plugin repository or the name after the prefix is empty — the caller
 * then refuses rather than inventing a name.
 */
export function pluginNameFromRepo(url: string): string | null {
  const repo = parseGithubPluginRepo(url);
  if (!repo) return null;
  const lowered = repo.repo.toLowerCase();
  if (!lowered.startsWith(KABMO_PLUGIN_REPO_PREFIX)) return null;
  return lowered.slice(KABMO_PLUGIN_REPO_PREFIX.length) || null;
}

/**
 * The `owner/repo` identity a value names, accepting BOTH spellings a stored
 * catalog may hold: the full URL a registration was typed as, and the canonical
 * `owner/repo` the registration itself writes. Without the expansion, an entry
 * stored as `acme/kabmo-plugins-kanban` would never match the URL it came from.
 */
function githubIdentity(value: string): string | null {
  const repo = parseGithubPluginRepo(normalisePluginSpec(value) ?? value);
  return repo ? `${repo.owner}/${repo.repo}`.toLowerCase() : null;
}

/** True when both URLs name the same GitHub repository (or the same source string). */
export function samePluginRepo(left: string, right: string): boolean {
  const a = githubIdentity(left);
  const b = githubIdentity(right);
  if (a && b) return a === b;
  const normalise = (value: string) => value.trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
  return normalise(left) === normalise(right);
}

/**
 * A stable key for "this install came from this repository", used to mark a
 * registered offer installed even when the plugin's manifest id differs from the
 * name the repository name suggests.
 *
 * GitHub URLs collapse to `owner/repo` in one case so an `https`, an `ssh` and
 * a `git@` spelling of one clone share a key. Anything else is compared as a
 * trimmed, suffix-stripped string.
 */
export function pluginRepoKey(url: string): string {
  return githubIdentity(url) ?? url.trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

/**
 * Expand the two spellings a user may type for a plugin source.
 *
 * `owner/repo` is GitHub's shorthand — the pane documents it, and requiring the
 * full URL for the one host the naming rule targets would be gratuitous. A local
 * path or a full URL is returned as typed, and a bare plugin NAME returns null so
 * the caller can resolve it against the registered registries instead.
 */
export function normalisePluginSpec(spec: string): string | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  if (isGitUrl(trimmed)) return trimmed;
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) return `https://github.com/${trimmed}`;
  return null;
}
