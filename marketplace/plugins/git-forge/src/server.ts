/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Forge's server half: where a read happens, and where a write happens.
 *
 * A browser cannot read a repository's `origin`, and it must not hold an API
 * token, so the panel asks this half for everything it draws and everything it
 * changes. Each call resolves the same four things in the same order — the
 * directory, the remote, the credential, the cache — which is why they live in
 * one `contextFor` rather than in each method.
 *
 * Four rules the panel depends on:
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
 * - **A write is checked against the capability table BEFORE the host is
 *   asked.** `writeRefusal` names what is missing, so a reader never meets a 403
 *   from an API they did not know was involved.
 */

import type { KabmoPluginApi } from '@kabmo-labs/kabmo-sdk';

import {
  RPC,
  defaultFilter,
  isSection,
  isState,
  type ForgeCounts,
  type ForgeCredential,
  type ForgeDetail,
  type ForgeFilter,
  type ForgeList,
  type ForgeSection,
  type ForgeWrite,
  type ForgeWriteResult,
} from './protocol';
import { writeRefusal } from './server/capabilities';
import { adapterFor } from './server/registry';
import { kvCache, type JsonCache } from './server/http';
import { invalidateWhere } from './server/write-http';
import { parseRemote, type ProviderPreference } from './server/remote';
import { readOrigin, resolveScope, type Scope } from './server/scope';
import { resolveToken } from './server/token';
import { probeWriteScope } from './server/scope-probe';
import { patchedItem, performWrite } from './server/writes';
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
    provider:
      provider === 'github' || provider === 'gitlab' || provider === 'gitea' || provider === 'bitbucket'
        ? provider
        : 'auto',
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

/** A filter off the wire, defaulted per field so a partial one is still usable. */
function readFilter(input: unknown): ForgeFilter {
  const fallback = defaultFilter();
  if (typeof input !== 'object' || input === null) return fallback;
  const record = input as Record<string, unknown>;
  return {
    state: isState(record.state) ? record.state : fallback.state,
    mine: record.mine === true,
    label: typeof record.label === 'string' ? record.label : '',
    query: typeof record.query === 'string' ? record.query : '',
  };
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
    filter: readFilter((input as { filter?: unknown } | null)?.filter),
    cache,
  };
}

/** The plugin's server half. */
export default function plugin(api: KabmoPluginApi) {
  const cache = kvCache(api.storage.kv);

  api.rpc.register<{ root: string; repo: string; filter: unknown }, ForgeList>(RPC.list, {
    handler: async (input) => {
      const context = await contextFor(api, cache, input);
      return adapterFor(context.provider).list(context);
    },
  });

  api.rpc.register<{ root: string; repo: string; section: unknown; id: unknown }, ForgeDetail>(RPC.detail, {
    handler: async (input) => {
      if (!isSection(input?.section)) throw new Error('That request did not name a section.');
      if (typeof input.id !== 'string' || !input.id.trim()) throw new Error('That request did not name an item.');
      const section: ForgeSection = input.section;

      const context = await contextFor(api, cache, input);
      const detail = await adapterFor(context.provider).detail(context, section, input.id);
      if ('error' in detail) throw new Error(detail.error);
      return detail;
    },
  });

  api.rpc.register<{ root: string; repo: string; section: unknown; id: unknown; write: unknown }, ForgeWriteResult>(
    RPC.write,
    {
      handler: async (input) => {
        if (!isSection(input?.section)) throw new Error('That request did not name a section.');
        if (typeof input.id !== 'string' || !input.id.trim()) throw new Error('That request did not name an item.');
        const write = readWrite(input.write);
        if (!write) throw new Error('That request did not name a write this panel performs.');
        const section: ForgeSection = input.section;

        const context = await contextFor(api, cache, input);
        const refusal = writeRefusal(write, {
          provider: context.provider,
          section,
          hasCredential: Boolean(context.token),
        });
        if (!refusal.ok) throw new Error(refusal.reason);

        const performed = await performWrite(context, section, input.id, write);
        if (!performed.ok) throw new Error(performed.message);

        // The write changed the item AND the list it came from, which are two
        // different cached URLs — so every entry for this repository goes.
        await invalidateWhere(cache, (url) => url.includes(encodeURIComponent(context.slug)) || url.includes(context.slug));

        const detail = await adapterFor(context.provider).detail(context, section, input.id);
        if ('error' in detail) throw new Error(`${performed.message} But the item could not be re-read: ${detail.error}`);
        return { item: patchedItem(detail.item, write), message: performed.message };
      },
    },
  );

  api.rpc.register<{ root: string; repo: string }, ForgeCounts>(RPC.counts, {
    handler: async (input) => {
      // The same list read, narrowed to the two sections a header can show. It
      // is NOT a separate endpoint per host: the counts are the list's own
      // totals, so the readout and the panel cannot disagree about how many
      // issues are open.
      const context = await contextFor(api, cache, { ...(input as object), filter: { ...defaultFilter(), mine: true } });
      const list = await adapterFor(context.provider).list(context);
      // "Assigned to me" is not a question an anonymous read can answer, and a
      // page length drawn as a count is a confident wrong number. Measured on
      // Gitea: an anonymous `assigned=true` read answered a full page, so the
      // readout said `3 issues · 3 PRs` for a reader who has none.
      if (!context.token) {
        return {
          issues: null,
          pulls: null,
          host: context.host,
          note: 'Set a token to see what is assigned to you: an anonymous read cannot answer it.',
        };
      }
      const counted = (section: 'issues' | 'pulls'): number | null => {
        const data = list.sections[section];
        if (data.total !== null) return data.total;
        // A host that reports no total (GitLab) still answers a page; the count
        // is then the page's own length, and the readout says `30+` from the
        // truncation flag rather than pretending it is the whole number.
        return data.items.length > 0 || data.truncated ? data.items.length : 0;
      };
      return { issues: counted('issues'), pulls: counted('pulls'), host: context.host, note: null };
    },
  });

  api.rpc.register<{ root: string; repo: string; probe?: unknown }, ForgeCredential>(RPC.credential, {
    handler: async (input) => {
      const context = await contextFor(api, cache, input);
      const source = await resolveCredentialSource(api, context);
      return {
        source: source.source,
        present: Boolean(context.token),
        // Probed only when the caller asks (`probe: true`, which the panel sends
        // when the reader opens the credential sheet): it is one request against
        // the same budget the reads use, and a panel mount must not spend it.
        // A host that does not report scopes answers null, which is honest and
        // different from false.
        writeScope: input?.probe === true ? await probeWriteScope(context) : null,
      };
    },
  });
}

/** Which source supplied the credential, for a panel that wants to say so. */
async function resolveCredentialSource(
  api: KabmoPluginApi,
  context: ForgeContext,
): Promise<{ source: ForgeCredential['source'] }> {
  const settings = await readSettings(api);
  const resolved = resolveToken(context.provider, { setting: settings.token, env: Bun.env });
  return { source: resolved.source };
}

/** A write off the wire, or null when it is not one this panel performs. */
function readWrite(input: unknown): ForgeWrite | null {
  if (typeof input !== 'object' || input === null) return null;
  const record = input as Record<string, unknown>;
  if (record.kind === 'comment' && typeof record.body === 'string') {
    return { kind: 'comment', body: record.body };
  }
  if (record.kind === 'state' && (record.state === 'open' || record.state === 'closed')) {
    return { kind: 'state', state: record.state };
  }
  if (
    record.kind === 'review' &&
    (record.verdict === 'approve' || record.verdict === 'request_changes') &&
    typeof record.body === 'string'
  ) {
    return { kind: 'review', verdict: record.verdict, body: record.body };
  }
  if (
    record.kind === 'merge' &&
    (record.method === 'merge' || record.method === 'squash' || record.method === 'rebase')
  ) {
    return { kind: 'merge', method: record.method };
  }
  return null;
}
