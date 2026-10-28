/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Forge's server half: where a read actually happens.
 *
 * A browser cannot read a repository's `origin`, and it must not hold an API
 * token, so the panel asks this half for everything it draws. Each call resolves
 * the same four things in the same order — the directory, the remote, the
 * credential, the cache — which is why they live in one `prepare` rather than in
 * each method.
 *
 * Three rules the panel depends on:
 *
 * - **The scope comes from the client, and is validated here.** A path is read
 *   with the server's own rights, so `root` must be absolute and `repo` must
 *   stay inside it (`scope.ts`).
 * - **A refusal is a THROW, and the host turns it into `{ok:false}`.** A handler
 *   answers its declared value; the route is what wraps it. Throwing here is
 *   therefore the sanctioned way to refuse, and the message is what the panel
 *   shows verbatim.
 * - **No token, no problem, until it is one.** A public repository reads
 *   anonymously; the note says so, and a 401 from a private one is the panel's
 *   prompt to set a credential.
 */

import type { KabmoPluginApi } from '@kabmo-labs/kabmo-sdk';

import { RPC, isSection, isState, type ForgeDetail, type ForgeList, type ForgeSection } from './protocol';
import { kvCache, type JsonCache } from './server/http';
import { parseRemote, type ProviderPreference } from './server/remote';
import { readOrigin, resolveScope, type Scope } from './server/scope';
import { resolveToken } from './server/token';
import { detailGithub, listGithub } from './server/github';
import { detailGitlab, listGitlab } from './server/gitlab';
import type { ForgeContext } from './server/context';

/** Sizing a read, from the plugin's own settings. */
interface Settings {
  token: string;
  provider: ProviderPreference;
  apiBase: string;
  perPage: number;
}

const DEFAULT_PER_PAGE = 30;

/** The settings, with defaults for anything unset or unreadable. */
async function readSettings(api: KabmoPluginApi): Promise<Settings> {
  const values = await api.settings.read();
  const provider = String(values.provider ?? 'auto');
  const perPage = Number(values.perPage ?? DEFAULT_PER_PAGE);
  return {
    token: String(values.token ?? ''),
    provider: provider === 'github' || provider === 'gitlab' ? provider : 'auto',
    apiBase: String(values.apiBase ?? ''),
    perPage: Number.isFinite(perPage) ? Math.min(100, Math.max(1, perPage)) : DEFAULT_PER_PAGE,
  };
}

/** A scope off the wire, or null when it is not one. */
function readScope(input: unknown): Scope | null {
  if (typeof input !== 'object' || input === null) return null;
  const record = input as Record<string, unknown>;
  if (typeof record.root !== 'string' || typeof record.repo !== 'string') return null;
  return { root: record.root, repo: record.repo };
}

/**
 * Everything a read needs, or a thrown sentence explaining what is missing.
 *
 * The cache is created once per plugin load and reused: it is a view over the
 * plugin's own key/value store, so rebuilding it per call would only allocate.
 */
async function contextFor(api: KabmoPluginApi, cache: JsonCache, input: unknown): Promise<ForgeContext> {
  const scope = readScope(input);
  if (!scope) throw new Error('That request did not name a workspace and a repository.');

  const dir = resolveScope(scope);
  if (!dir) throw new Error('That repository is outside the workspace it was asked for.');

  const origin = readOrigin(dir);
  if (!origin) {
    throw new Error(
      'This repository has no origin remote, so there is no forge to read. Add one with `git remote add origin <url>`.',
    );
  }

  const settings = await readSettings(api);
  const remote = parseRemote(origin, { provider: settings.provider, apiBase: settings.apiBase });
  if ('error' in remote) throw new Error(remote.error);

  const token = resolveToken(remote.provider, { setting: settings.token, env: Bun.env });
  return {
    provider: remote.provider,
    apiBase: remote.apiBase,
    slug: remote.slug,
    webUrl: remote.webUrl,
    host: remote.host,
    token: token.token,
    perPage: settings.perPage,
    cache,
  };
}

/** The plugin's server half. */
export default function plugin(api: KabmoPluginApi) {
  const cache = kvCache(api.storage.kv);

  api.rpc.register<{ root: string; repo: string; state: unknown }, ForgeList>(RPC.list, {
    handler: async (input) => {
      const context = await contextFor(api, cache, input);
      const state = isState(input?.state) ? input.state : 'open';
      return context.provider === 'github' ? listGithub(context, state) : listGitlab(context, state);
    },
  });

  api.rpc.register<{ root: string; repo: string; section: unknown; id: unknown }, ForgeDetail>(RPC.detail, {
    handler: async (input) => {
      if (!isSection(input?.section)) throw new Error('That request did not name a section.');
      if (typeof input.id !== 'string' || !input.id.trim()) throw new Error('That request did not name an item.');
      const section: ForgeSection = input.section;

      const context = await contextFor(api, cache, input);
      const detail =
        context.provider === 'github'
          ? await detailGithub(context, section, input.id)
          : await detailGitlab(context, section, input.id);
      if ('error' in detail) throw new Error(detail.error);
      return detail;
    },
  });
}
