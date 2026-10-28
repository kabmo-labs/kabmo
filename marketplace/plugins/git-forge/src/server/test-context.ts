/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One `ForgeContext` per host, for the adapter suites.
 *
 * Shared rather than copied into each suite: four hosts × the same eight fields
 * is four places a new field is forgotten, and a context that is missing one
 * would make a suite pass against a shape the server never builds.
 */

import type { ForgeContext } from './context';
import type { ForgeFilter, ForgeProvider } from '../protocol';
import { coldCache } from './test-host';

/** The filter every suite starts from. */
export function openFilter(): ForgeFilter {
  return { state: 'open', mine: false, label: '', query: '' };
}

/** The API roots the real parser derives, so a suite's URLs are the ones shipped. */
const ROOTS: Record<ForgeProvider, { apiBase: string; host: string; slug: string; webUrl: string }> = {
  github: {
    apiBase: 'https://api.github.com',
    host: 'github.com',
    slug: 'kabmo-labs/kabmo',
    webUrl: 'https://github.com/kabmo-labs/kabmo',
  },
  gitlab: {
    apiBase: 'https://gitlab.com/api/v4',
    host: 'gitlab.com',
    slug: 'group/project',
    webUrl: 'https://gitlab.com/group/project',
  },
  gitea: {
    apiBase: 'https://gitea.example.com/api/v1',
    host: 'gitea.example.com',
    slug: 'team/app',
    webUrl: 'https://gitea.example.com/team/app',
  },
  bitbucket: {
    apiBase: 'https://api.bitbucket.org/2.0',
    host: 'bitbucket.org',
    slug: 'team/app',
    webUrl: 'https://bitbucket.org/team/app',
  },
};

/** A context for one host, with the fetch a suite supplies. */
export function hostContext(
  provider: ForgeProvider,
  fetchImpl: typeof fetch,
  overrides: Partial<ForgeContext> = {},
): ForgeContext {
  return {
    provider,
    ...ROOTS[provider],
    token: 'token_test',
    perPage: 30,
    filter: openFilter(),
    cache: coldCache(),
    fetchImpl,
    ...overrides,
  };
}
