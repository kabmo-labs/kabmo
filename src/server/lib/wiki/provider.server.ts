/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which wiki host is in front of us.
 *
 * The content read needs no provider at all — GitHub and GitLab publish the
 * same `.wiki.git` — but two things the reader shows do: the label in the header
 * and the "open in browser" URL, and the two hosts spell a wiki page
 * differently (`/wiki/Page` against `/-/wikis/Page`).
 *
 * `github.com` and `gitlab.com` are decided by name, with no request. Anything
 * else is probed once per host: a GitLab instance answers `/api/v4/version` with
 * JSON (401 unauthenticated, 200 with a token), and the self-hosted GitLab this
 * feature was built against does exactly that. The probe runs only AFTER a wiki
 * fetch has succeeded, so it never delays the common failure path, and its
 * verdict — including "not GitLab" — is cached for the life of the process.
 */

import type { WikiProvider } from '@/shared/types/wiki';

const HOST_PROBE_TIMEOUT_MS = 3_000;

interface HostVerdict {
  provider: WikiProvider;
  at: number;
}

/** One day: a host does not change product between two panel reads. */
const VERDICT_TTL_MS = 24 * 60 * 60 * 1000;

interface ProviderCacheHost {
  hosts: Map<string, HostVerdict>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoWikiProviders: ProviderCacheHost | undefined;
}

function cache(): Map<string, HostVerdict> {
  globalThis.__kabmoWikiProviders ??= { hosts: new Map() };
  return globalThis.__kabmoWikiProviders.hosts;
}

function byName(host: string): WikiProvider | null {
  const lower = host.toLowerCase();
  if (lower === 'github.com' || lower.endsWith('.github.com')) return 'github';
  if (lower === 'gitlab.com' || lower.endsWith('.gitlab.com')) return 'gitlab';
  // A self-hosted instance named after the product (`gitlab.example.com`).
  if (/(^|[.-])gitlab([.-]|$)/.test(lower)) return 'gitlab';
  return null;
}

/** True when the host answers GitLab's version endpoint the way GitLab does. */
async function answersAsGitlab(host: string): Promise<boolean> {
  try {
    const response = await fetch(`https://${host}/api/v4/version`, {
      method: 'GET',
      signal: AbortSignal.timeout(HOST_PROBE_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    // 401 is the unauthenticated answer and is as good a signal as 200.
    if (response.status !== 200 && response.status !== 401) return false;
    return (response.headers.get('content-type') ?? '').includes('json');
  } catch {
    return false;
  }
}

export async function detectWikiProvider(host: string): Promise<WikiProvider> {
  const known = byName(host);
  if (known) return known;

  const verdicts = cache();
  const cached = verdicts.get(host);
  if (cached && Date.now() - cached.at < VERDICT_TTL_MS) return cached.provider;

  const provider: WikiProvider = (await answersAsGitlab(host)) ? 'gitlab' : 'other';
  verdicts.set(host, { provider, at: Date.now() });
  return provider;
}
