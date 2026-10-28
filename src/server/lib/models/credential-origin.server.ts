/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * WHERE omp resolves a provider's credential from — the distinction its own
 * `/login` selector prints as `--api-key` / `config` / `login` / `api key` /
 * `env`, folded to the four values that change what the settings UI may offer.
 *
 * The panel used to report every login provider as `omp auth credentials`,
 * which hid the two cases that matter: a provider authenticated by an
 * environment variable has NOTHING stored to remove (so `sign out` can only
 * fail), and a `models.yml` key is edited in the entry, not through a login
 * flow. `get_login_providers` answers only `authenticated`, so the origin has to
 * be assembled from the stores omp itself reads.
 *
 * ONE scan of `agent.db` for the whole list, never one per provider: the panel
 * asks for every provider omp knows, and a per-provider open would be ~60
 * connections for one page load.
 */

import { join } from 'path';
import { Database } from 'bun:sqlite';
import { getAgentDir } from '@/server/lib/omp/core/paths';
import { readNativeProviders } from '@/server/lib/omp/config/models-config';
import type { ProviderCredentialOrigin } from '@/shared/types/settings/provider';

const AUTH_CREDENTIALS_TABLE = 'auth_credentials';
const API_KEY_CREDENTIAL_TYPE = 'api_key';
const OAUTH_CREDENTIAL_TYPE = 'oauth';

/** Credential kinds present in omp's `agent.db`, keyed by lower-case slug. */
export interface AgentDbCredentialIndex {
  /** Slugs with a live api-key credential. */
  apiKey: Set<string>;
  /** Slugs with a live OAuth credential. */
  oauth: Set<string>;
}

/**
 * Read every live credential's KIND from omp's agent.db.
 *
 * A missing or unreadable store is an empty index rather than an error: the
 * caller's answer then degrades to "no stored credential", which is the truth
 * as far as Kabmo can see, and the panel keeps working on a machine where omp
 * has never written one.
 */
export async function readAgentDbCredentialIndex(): Promise<AgentDbCredentialIndex> {
  const index: AgentDbCredentialIndex = { apiKey: new Set(), oauth: new Set() };
  const dbPath = join(getAgentDir(), 'agent.db');
  if (!(await Bun.file(dbPath).exists())) return index;
  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const rows = db
      .query<{ provider?: string; credential_type?: string }, []>(
        `SELECT provider, credential_type FROM ${AUTH_CREDENTIALS_TABLE} WHERE disabled_cause IS NULL`,
      )
      .all();
    for (const row of rows) {
      const slug = typeof row.provider === 'string' ? row.provider.trim().toLowerCase() : '';
      if (!slug) continue;
      if (row.credential_type === OAUTH_CREDENTIAL_TYPE) index.oauth.add(slug);
      else if (row.credential_type === API_KEY_CREDENTIAL_TYPE) index.apiKey.add(slug);
    }
  } catch {
    return index; // no-excuse-ok: catch — best-effort read of an external store
  } finally {
    db?.close();
  }
  return index;
}

/**
 * The origin for one provider, from the facts already in hand.
 *
 * `models.yml` wins over a stored key because that is the file the user edits
 * in this panel: a provider carrying both would otherwise report `api key` and
 * leave the entry's own key invisible. `environment` is the honest answer for
 * an authenticated provider with nothing in either store — that is an env var,
 * a `!command`, or a `config.yml` key, and none of them can be removed here.
 */
export function resolveCredentialOrigin(input: {
  slug: string;
  authenticated: boolean;
  inModelsYml: boolean;
  hasModelsYmlKey: boolean;
  credentials: AgentDbCredentialIndex;
}): ProviderCredentialOrigin | undefined {
  const slug = input.slug.trim().toLowerCase();
  if (input.hasModelsYmlKey) return 'models.yml';
  if (input.credentials.oauth.has(slug)) return 'login';
  if (input.credentials.apiKey.has(slug)) return 'api-key';
  if (input.authenticated) return 'environment';
  return undefined;
}

/** Slugs carrying an `apiKey` in models.yml, plus every native entry. */
export async function readModelsYmlKeySlugs(): Promise<Set<string>> {
  const native = await readNativeProviders();
  return new Set(
    native
      .filter((info) => info.hasApiKey === true)
      .map((info) => info.slug.trim().toLowerCase()),
  );
}

