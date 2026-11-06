/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Write a provider into a harness's OWN registry, in that harness's own format.
 *
 * One writer per FORMAT, dispatched by `HARNESS_PROVIDER_FACTS`. Every format
 * merges rather than rewrites — these files also hold plugins, agents, MCP
 * servers and approval policy — refuses an unparseable file untouched, keeps a
 * stored credential and the user's own dialect on update, and writes 0600
 * because the file can hold a key.
 *
 * Two rules decide whether an import is HONEST, and both live here because this
 * is the only place that touches disk:
 *
 *  - **A vendor id is never written.** `anthropic` copied into codex would
 *    override codex's own built-in provider instead of adding a gateway; the
 *    import list filters those rows out (`vendors.ts`) and the writer refuses
 *    one that arrives anyway.
 *  - **A format that stores a VARIABLE NAME gets the value elsewhere.** codex's
 *    `env_key` and qwen's `envKey` name an env var; writing the name and no
 *    value leaves every request unauthenticated. The write answers with the env
 *    lines the caller must save into the harness config, so the credential lands
 *    where the agent actually reads it.
 */

import { writeFileAtomic } from '@/server/lib/fs/atomic-write';
import { parseDocument, providerMap, serialise } from '@/server/lib/harness/provider-file.server';
import { withConfigLock } from '@/server/lib/fs/config-lock';
import { providerFacts, type ProviderRegistryKind } from '@/shared/lib/harness/provider-facts';
import {
  adaptBaseUrl,
  dialectFor,
  planProtocol,
  supportedProtocols,
  type CanonicalProtocol,
} from '@/shared/lib/harness/dialects';
import { isVendorProviderId } from '@/shared/lib/models/provider/vendors';
import { registryFilePath, readProviderKey, readRegistryProviders } from '@/server/lib/harness/provider-sources.server';
import { asRecord, modelRowsFor, providerEntryFor, type ProviderDraft } from '@/server/lib/harness/provider-entry';
import { ProviderWriteError } from '@/server/lib/harness/provider-write-error';
import type { HarnessId } from '@/shared/lib/harness/catalog';

/** What a successful write changed, so the card can report it rather than guess. */
export interface ProviderWriteResult {
  id: string;
  replaced: boolean;
  path: string;
  /** The protocol that landed, at the target's own spelling. */
  dialect: string;
  /** Env lines the caller must save for a variable-name format (`KEY=VALUE`). */
  env: Record<string, string>;
  /** Facts the UI repeats verbatim — a restart, an injected variable name. */
  notes: string[];
}

/**
 * A provider id each format accepts as a key.
 *
 * `.` and `:` are legal in kimi's provider names (`managed:kimi-code`) and in
 * opencode's model ids, so the pattern is the INTERSECTION that every format
 * accepts rather than the strictest one — an id the source already holds must
 * not be refused by a target that could spell it.
 */
const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

/**
 * Under `bun test`, a write is confined to a temp `HOME`.
 *
 * This is not defensive styling. A verification run of this very feature wrote
 * into the developer's real `~/.codex/config.toml`, `~/.pi/agent/models.json`,
 * `~/.kimi/config.toml`, `~/.qwen/settings.json` and `~/.omp/agent/models.yml`,
 * because a test process with `HOME` reassigned was fine while a REAL server
 * (started for a browser check) was not. A registry is an agent's working config:
 * a test that reaches the real one breaks an install, so the check lives at the
 * ONE place that writes.
 *
 * `KABMO_TEST_HOME` is the escape hatch: a suite that WANTS a real path in a temp
 * root sets it, and the guard allows a path under it.
 */
function assertWritableUnderTest(path: string): void {
  if (!Bun.env.KABMO_TEST_HOME) return;
  const allowed = Bun.env.KABMO_TEST_HOME;
  if (!path.startsWith(allowed)) {
    throw new ProviderWriteError(
      `refusing to write ${path}: under test, writes are limited to ${allowed}`,
    );
  }
}

/**
 * The protocol a draft should land as, and the base URL that fits the target.
 *
 * `protocol` on the draft is authoritative when the target speaks it (a probe
 * measured it against the live endpoint). Otherwise the source's own protocol is
 * kept — the API is the source's, the file is the target's.
 */
function planFor(target: HarnessId, draft: ProviderDraft): { protocol: CanonicalProtocol; baseUrl: string } {
  const facts = providerFacts(target);
  const target_protocols = supportedProtocols(facts.registry.kind, facts.envProtocol);
  const protocol = planProtocol(draft.protocol ?? null, target_protocols);
  if (!protocol) {
    throw new ProviderWriteError(
      `${target} has no protocol that matches "${draft.id}" (${draft.protocol ?? 'unknown dialect'}). `
      + `It accepts: ${target_protocols.join(', ') || 'none'}.`,
    );
  }
  if (dialectFor(facts.registry.kind, protocol) === null) {
    throw new ProviderWriteError(
      `${target} cannot speak ${protocol}: it stores no such dialect.`,
    );
  }
  // An env target is a vendor SDK, which appends the version itself: measured,
  // Claude Code with `.../v1` requested `/v1/v1/messages` and answered an empty
  // turn. A registry target appends only the route, so its base keeps `/v1`.
  const baseUrl = adaptBaseUrl(draft.baseUrl ?? '', facts.registry.kind === 'env' ? 'root' : 'api-base');
  return { protocol, baseUrl };
}

/**
 * The variable NAME a variable-name format stores, and the env line it needs.
 *
 * Derived from the provider id rather than a fixed `OPENAI_API_KEY`: measured,
 * two providers added to qwen both wrote that one name, so adding the second
 * silently re-pointed the first at a different key. `KENARI_ID_API_KEY` is
 * unique per provider by construction, and the env block carries its value.
 */
function credentialEnvFor(kind: ProviderRegistryKind, draft: ProviderDraft): Record<string, string> {
  if (!draft.apiKey) return {};
  if (kind !== 'toml-model-providers' && kind !== 'json-model-providers') return {};
  const name = `${draft.id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
  return { [name]: draft.apiKey };
}

/**
 * Merge ONE provider into a harness's registry.
 *
 * Returns what changed — the id, whether it replaced an entry, the dialect that
 * landed, the env lines a variable-name format needs, and the notes the card must
 * repeat — so the UI reports facts instead of a bare success.
 */
export async function writeProvider(
  target: HarnessId,
  draft: ProviderDraft,
): Promise<ProviderWriteResult> {
  const facts = providerFacts(target);
  // The ORDER matters for the message: an agent-managed registry (minimax) has
  // no path Kabmo owns, and telling that reader "no registry Kabmo writes" hides
  // the true situation — a registry exists, `mcode` owns it.
  if (!facts.registry.writable) {
    throw new ProviderWriteError(
      facts.registry.kind === 'agent-managed'
        ? `${target} keeps its providers itself; add one with its own command`
        : `${target} has no provider registry Kabmo writes`,
    );
  }
  const path = registryFilePath(target);
  if (!path) throw new ProviderWriteError(`${target} has no provider registry Kabmo writes`);
  assertWritableUnderTest(path);

  const id = draft.id.trim().toLowerCase();
  if (!ID_PATTERN.test(id)) {
    throw new ProviderWriteError(`"${id}" is not a provider id ${target} accepts (lowercase, digits, . _ : -)`);
  }
  if (isVendorProviderId(id, facts.registry.bundledIds)) {
    throw new ProviderWriteError(
      `"${id}" is a provider ${target} ships itself, so writing it would override the vendor's entry instead of `
      + 'adding a gateway. Only providers you registered yourself can be imported.',
    );
  }

  const kind = facts.registry.kind;
  const plan = planFor(target, draft);
  const planned: ProviderDraft = { ...draft, protocol: plan.protocol, baseUrl: plan.baseUrl };
  const dialect = dialectFor(kind, plan.protocol) ?? '';
  const env = credentialEnvFor(kind, planned);
  const notes: string[] = [];

  return withConfigLock(path, async () => {
    const file = Bun.file(path);
    const raw = (await file.exists()) ? await file.text() : '';
    const doc = raw.trim() ? parseDocument(kind, raw, path) : {};

    if (kind === 'json-model-providers') {
      // Array-per-protocol: the protocol key is the BUCKET, and every row is a
      // model. The bucket comes from the planned protocol, not from the provider
      // id: a provider called `gateway` used to land in an `openai` bucket by
      // accident of the id, which routed an Anthropic endpoint through the
      // OpenAI SDK.
      const groups = providerMap(doc, facts.registry.pointer, path);
      const bucket = dialect;
      const list = Array.isArray(groups[bucket]) ? (groups[bucket] as unknown[]) : [];
      // A provider is a SET of model rows here, and qwen identifies a row by
      // protocol + id + baseUrl (its own docs). Finding a row by id alone made
      // two gateways serving one model id collapse into one, so the second add
      // silently replaced the first.
      const baseUrl = planned.baseUrl;
      let replaced = false;
      for (const modelId of planned.models.length > 0 ? planned.models : [planned.id]) {
        const incoming = providerEntryFor(kind, { ...planned, models: [modelId] }, target);
        const index = list.findIndex((entry) => {
          const row = asRecord(entry);
          return row.id === incoming.id && (row.baseUrl ?? '') === (baseUrl ?? '');
        });
        if (index >= 0) {
          list[index] = { ...asRecord(list[index]), ...incoming };
          replaced = true;
        } else {
          list.push(incoming);
        }
      }
      groups[bucket] = list;
      // qwen reads the value from `env`, never from the row — its docs are
      // explicit that `envKey` is a NAME.
      const envBlock = asRecord(doc.env);
      if (planned.apiKey) {
        doc.env = { ...envBlock, ...env };
        notes.push('The key was written to settings.json `env` — qwen reads `envKey` as a variable NAME.');
      }
      await writeFileAtomic(path, serialise(kind, doc), { createMode: 0o600 });
      return { id, replaced, path, dialect: bucket, env, notes };
    }

    const providers = providerMap(doc, facts.registry.pointer, path);
    const replaced = Object.prototype.hasOwnProperty.call(providers, id);
    const existing = asRecord(providers[id]);
    const incoming = providerEntryFor(kind, planned, target);
    // The user's own choices win over the import's defaults; the import still
    // brings the endpoint and the model rows.
    const merged = {
      ...incoming,
      ...(replaced ? pickExisting(existing, incoming) : {}),
    };
    providers[id] = merged;

    // Formats that select models by ALIAS need the model table beside the
    // provider, or the agent lists the provider and serves nothing from it.
    if (facts.registry.modelsAreRows) {
      const models = asRecord(doc[facts.registry.modelsField ?? 'models']);
      const rows = modelRowsFor(kind, planned);
      for (const [alias, row] of Object.entries(rows)) {
        models[alias] = { ...asRecord(models[alias]), ...row };
      }
      doc[facts.registry.modelsField ?? 'models'] = models;
      if (Object.keys(rows).length > 0) {
        notes.push(`Wrote ${Object.keys(rows).length} model alias${Object.keys(rows).length === 1 ? '' : 'es'} into ${facts.registry.modelsField} — kimi selects models by alias.`);
      } else {
        // A provider with no alias is invisible to the agent's model picker. That
        // is a legitimate intermediate state (the user may add models next), but
        // reporting a bare success would read as "ready".
        notes.push('No model ids were given, so this provider has no alias yet — it serves nothing until one is added.');
      }
    }

    // Measured: omp serves NOTHING from an entry with no models and no
    // `discovery` block, and says nothing about it. Reporting a bare success
    // would let the user ship a provider that answers no model at all.
    const modelCount = Array.isArray(merged.models) ? merged.models.length : 0;
    const declaresDiscovery = asRecord(merged.discovery).type !== undefined;
    if (modelCount === 0 && !declaresDiscovery && !facts.registry.modelsAreRows) {
      notes.push('No models on this provider yet — the agent serves nothing from it until ids are added (or it is registered as discovery).');
    }

    if (env && Object.keys(env).length > 0) {
      notes.push(`Set ${Object.keys(env).join(', ')} in this harness's environment — the file stores a variable NAME, not the key.`);
    }

    await writeFileAtomic(path, serialise(kind, doc), { createMode: 0o600 });
    return { id, replaced, path, dialect, env, notes };
  });
}

/**
 * The fields of an EXISTING entry that the import must not overwrite.
 *
 * A stored credential is the one that matters: an import brings an endpoint, and
 * replacing a key the user set by hand is not what asking to copy a provider
 * meant. `npm`/`type`/`wire_api` (the dialect) are kept too — they describe how
 * that provider already works, and the source's dialect is a guess about a
 * different agent.
 */
function pickExisting(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const keep: Record<string, unknown> = {};
  const scalarKeys = ['npm', 'type', 'wire_api', 'api', 'name'];
  for (const key of scalarKeys) {
    if (existing[key] !== undefined && incoming[key] !== undefined) keep[key] = existing[key];
  }
  // Credentials, in each format's spelling: a top-level apiKey/api_key, or one
  // nested inside opencode's `options`.
  if (typeof existing.apiKey === 'string' && existing.apiKey) keep.apiKey = existing.apiKey;
  if (typeof existing.api_key === 'string' && existing.api_key) keep.api_key = existing.api_key;
  const existingOptions = asRecord(existing.options);
  const incomingOptions = asRecord(incoming.options);
  if (Object.keys(incomingOptions).length > 0) {
    // `options` is merged key by key, so an endpoint arrives while a stored key
    // and any hand-written option stay.
    keep.options = { ...incomingOptions, ...existingOptions };
  }
  return keep;
}

/** The row the import list handed out, as the writer needs it. */
export interface ListedProvider {
  id: string;
  name: string;
  baseUrl?: string;
  protocol?: CanonicalProtocol;
  models: string[];
  contextWindow?: Record<string, number>;
}

/**
 * The draft for importing `source`'s provider into a target.
 *
 * `readProviderKey` is called HERE, and only here: the list the browser holds has
 * a boolean `hasKey`, never the credential.
 *
 * `measured` is the protocol a live probe found, when the import ran one. It
 * outranks the source's declared dialect because the endpoint is the authority:
 * measured on kenari, whose models.yml entry says `openai-completions` while the
 * host also answers Anthropic Messages — an import into claude has to use the
 * latter or Claude Code fails every request.
 */
export async function draftForImport(
  source: HarnessId,
  listed: ListedProvider,
  measured?: CanonicalProtocol | null,
): Promise<ProviderDraft> {
  const apiKey = await readProviderKey(source, listed.id);
  return {
    id: listed.id,
    name: listed.name,
    ...(listed.baseUrl ? { baseUrl: listed.baseUrl } : {}),
    ...(measured ?? listed.protocol ? { protocol: (measured ?? listed.protocol) as CanonicalProtocol } : {}),
    models: listed.models,
    ...(listed.contextWindow ? { contextWindow: listed.contextWindow } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

/** Every provider a harness could import FROM, custom only. */
export async function importableFrom(source: HarnessId) {
  return readRegistryProviders(source);
}

/** Re-exported so a caller imports one module for a write. */
export { ProviderWriteError, providerEntryFor };
export type { ProviderDraft };
