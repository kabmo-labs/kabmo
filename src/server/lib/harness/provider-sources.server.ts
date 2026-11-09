/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Read the providers OTHER harnesses already have, so a user can copy one
 * instead of retyping an endpoint and a key.
 *
 * One reader per FORMAT, not per harness: three harnesses write TOML, three write
 * JSON with a providers map, one writes JSON with a `modelProviders` array, and
 * omp writes YAML. `HARNESS_PROVIDER_FACTS` names the file, the pointer and the
 * field names, so a reader never guesses — and a harness added later is a row in
 * that table, not a new branch here.
 *
 * Two rules decide what a row IS:
 *
 *  - **CUSTOM only.** A registry ships its own providers, and one of those
 *    copied into another agent writes an override of the TARGET's vendor entry
 *    instead of adding a gateway — which is why the census in `vendors.ts`
 *    filters the list here and the writer refuses one that arrives anyway.
 *  - **A protocol, not a spelling.** Every id carries the canonical protocol its
 *    entry declares (`protocolOfSourceDialect`), so the card can say which
 *    targets can take it before the user presses Import.
 *
 * What is NEVER returned is the API KEY. A list is for CHOOSING a provider; the
 * key is read only by the request that writes the target, from the source file.
 * A list that carried keys would put them in every browser tab that opens
 * Settings, which is what the masked-key rule in `dialect.ts` exists to prevent.
 *
 * `minimax` is read for display and never used as an import SOURCE: its BYOK
 * store belongs to `mcode`'s writer, and copying a shape Kabmo cannot vouch for is
 * how an import writes something the agent then refuses.
 */

import { join } from 'path';
import YAML from 'yaml';
import { parse as parseToml } from 'smol-toml';

import { providerFacts, type ProviderRegistryKind } from '@/shared/lib/harness/provider-facts';
import { protocolOfSourceDialect, type CanonicalProtocol } from '@/shared/lib/harness/dialects';
import { isVendorProviderId } from '@/shared/lib/models/provider/vendors';
import { HARNESS_IDS, type HarnessId } from '@/shared/lib/harness/catalog';
import { canonicalize } from '@/server/lib/omp/core/paths';
import { readZcodeProviderKey, readZcodeProviders } from '@/server/lib/harness/provider-zcode.server';

/** One provider as a source registry holds it, minus its credential. */
export interface ImportableProvider {
  id: string;
  name: string;
  baseUrl?: string;
  /** The dialect/SDK/wire value the source declares, verbatim. */
  dialect?: string;
  /** That dialect folded onto the shared protocol vocabulary. */
  protocol?: CanonicalProtocol;
  models: string[];
  /** Context window per model id, when the source declared one (kimi requires it). */
  contextWindow?: Record<string, number>;
  /** The harness the entry came from — two sources can share an id. */
  source: HarnessId;
  /** True when the source has a credential stored. NOT the credential. */
  hasKey: boolean;
}

/** A record, or an empty one. Imported YAML/JSON/TOML is untrusted. */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * The user's home, read from the ENVIRONMENT rather than `os.homedir()`.
 *
 * `os.homedir()` resolves against the passwd entry on some platforms, so it
 * ignores a `HOME` set after the process started — which made every test that
 * points `HOME` at a temp directory write into the developer's real `~/.codex`.
 * `Bun.env.HOME` is the value the agents themselves read, so the paths Kabmo
 * writes and the paths they read cannot disagree.
 */
export function homeDir(): string {
  return Bun.env.HOME || Bun.env.USERPROFILE || '/';
}

/** The absolute path for a registry's `~`-relative file, or null. */
export function registryFilePath(id: HarnessId): string | null {
  const file = providerFacts(id).registry.file;
  return file ? join(homeDir(), file) : null;
}

/**
 * Every harness that reads the SAME registry file.
 *
 * `omp-rpc` and `omp-acp` are two transports over one `models.yml`, so a
 * provider written through either must invalidate the other's cached model
 * list. The comparison is the file itself, not a hand-written pair, so a future
 * harness that shares a registry inherits the rule for free.
 */
export function harnessesSharingRegistry(path: string): HarnessId[] {
  const key = canonicalize(path);
  return HARNESS_IDS.filter((id) => {
    const file = registryFilePath(id);
    return file !== null && canonicalize(file) === key;
  });
}

/** A value at a dot-path (`options.baseURL`), or undefined. */
function atPointer(root: Record<string, unknown>, pointer: string): unknown {
  let node: unknown = root;
  for (const key of pointer.split('.')) {
    const record = asRecord(node);
    if (!(key in record)) return undefined;
    node = record[key];
  }
  return node;
}

/** Read a file as text, or null when it is absent or unreadable. */
async function readText(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const file = Bun.file(path);
    return (await file.exists()) ? await file.text() : null;
  } catch {
    return null;
  }
}

/** Parse a document by its registry format, or null when it will not parse. */
function parseByKind(kind: ProviderRegistryKind, text: string): Record<string, unknown> | null {
  try {
    switch (kind) {
      case 'yaml-providers': return asRecord(YAML.parse(text));
      case 'toml-model-providers':
      case 'toml-providers': return asRecord(parseToml(text));
      case 'json-provider':
      case 'json-providers':
      case 'json-model-providers':
      case 'zcode-provider-rules': return asRecord(JSON.parse(text));
      default: return null;
    }
  } catch {
    // A malformed file is the AGENT's config, not Kabmo's: the reader returns no
    // rows rather than failing the settings page over a file it did not write.
    return null;
  }
}

/** Model ids from a per-format model collection: an array of objects, or a map. */
function modelIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry : String(asRecord(entry).id ?? '')))
      .filter(Boolean);
  }
  return Object.keys(asRecord(value));
}

/**
 * Context windows from a per-format model collection.
 *
 * kimi's `[models.<alias>]` table requires `max_context_size`, and models.yml /
 * pi declare `contextWindow` per model — both spellings are read here so an
 * import can carry the number the target needs instead of inventing one.
 */
function contextWindows(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const entries = Array.isArray(value)
    ? value.map((entry) => asRecord(entry))
    : Object.values(asRecord(value)).map((entry) => asRecord(entry));
  for (const entry of entries) {
    const id = typeof entry.id === 'string' ? entry.id : '';
    const window = entry.contextWindow ?? entry.max_context_size ?? entry.limit;
    const number = typeof window === 'number'
      ? window
      : typeof asRecord(window).context === 'number'
        ? (asRecord(window).context as number)
        : undefined;
    if (id && number && number > 0) out[id] = number;
  }
  return out;
}

/**
 * Every CUSTOM provider `id`'s own registry holds.
 *
 * A kind this build cannot read (`env`, `agent-managed`, `none`) yields nothing:
 * there is no file, so there is nothing to list. Vendor ids are dropped for the
 * reason at the top of this file.
 */
export async function readRegistryProviders(id: HarnessId): Promise<ImportableProvider[]> {
  const facts = providerFacts(id);
  const { kind, pointer, bundledIds } = facts.registry;
  if (kind === 'env' || kind === 'agent-managed' || kind === 'none') return [];

  const text = await readText(registryFilePath(id));
  if (!text) return [];
  const doc = parseByKind(kind, text);
  if (!doc) return [];

  // ZCode's registry is a rule GRAPH, not a providers map: one provider rule
  // plus one rule per model. Its reader lives beside its writer.
  if (kind === 'zcode-provider-rules') return readZcodeProviders(text, id);

  // `modelProviders` is an ARRAY per protocol (qwen), so its rows are the models
  // themselves and the provider id is the protocol key.
  if (kind === 'json-model-providers') {
    const groups = asRecord(atPointer(doc, pointer));
    const rows: ImportableProvider[] = [];
    for (const [protocol, entries] of Object.entries(groups)) {
      const canonical = protocolOfSourceDialect(protocol);
      for (const entry of Array.isArray(entries) ? entries : []) {
        const model = asRecord(entry);
        const modelId = typeof model.id === 'string' ? model.id : '';
        if (!modelId) continue;
        if (isVendorProviderId(modelId, bundledIds)) continue;
        const size = asRecord(model.generationConfig).contextWindowSize;
        rows.push({
          id: modelId,
          name: typeof model.name === 'string' ? model.name : modelId,
          ...(typeof model.baseUrl === 'string' ? { baseUrl: model.baseUrl } : {}),
          dialect: protocol,
          ...(canonical ? { protocol: canonical } : {}),
          models: [modelId],
          ...(typeof size === 'number' && size > 0 ? { contextWindow: { [modelId]: size } } : {}),
          source: id,
          hasKey: typeof model.envKey === 'string' && model.envKey.length > 0,
        });
      }
    }
    return rows;
  }

  const providers = asRecord(atPointer(doc, pointer));
  return Object.entries(providers)
    .filter(([slug]) => !isVendorProviderId(slug, bundledIds))
    .map(([slug, raw]) => {
      const entry = asRecord(raw);
      const baseUrl = facts.registry.baseUrlField ? atPointer(entry, facts.registry.baseUrlField) : undefined;
      const keyValue = facts.registry.apiKeyField ? atPointer(entry, facts.registry.apiKeyField) : undefined;
      const dialect = facts.registry.dialectField ? atPointer(entry, facts.registry.dialectField) : undefined;
      const rawModels = facts.registry.modelsField ? atPointer(entry, facts.registry.modelsField) : undefined;
      // kimi's provider entry declares no models at all; its aliases live in a
      // sibling table keyed by alias, each naming the provider it belongs to.
      const aliasModels = kind === 'toml-providers'
        ? Object.entries(asRecord(doc.models ?? {}))
          .filter(([, row]) => asRecord(row).provider === slug)
          .map(([alias, row]) => ({ alias, row: asRecord(row) }))
        : [];
      const models = aliasModels.length > 0
        ? aliasModels.map(({ row }) => String(row.model ?? ''))
        : modelIds(rawModels);
      const windows = kind === 'toml-providers'
        ? Object.fromEntries(aliasModels.map(({ row }) => [String(row.model ?? ''), Number(row.max_context_size)]))
        : contextWindows(rawModels);
      const protocol = protocolOfSourceDialect(typeof dialect === 'string' ? dialect : undefined);
      return {
        id: slug,
        // The entry's own `name` when it declares one — an "Add provider" row
        // stored the display name for exactly this, and printing the slug back
        // makes the card look like it lost what the form asked for.
        name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : slug,
        ...(typeof baseUrl === 'string' ? { baseUrl } : {}),
        ...(typeof dialect === 'string' ? { dialect } : {}),
        ...(protocol ? { protocol } : {}),
        models,
        ...(Object.keys(windows).length > 0 ? { contextWindow: windows } : {}),
        source: id,
        hasKey: typeof keyValue === 'string' && keyValue.length > 0,
      };
    });
}

/**
 * Every CUSTOM provider importable INTO `target`, from the sources its facts allow.
 *
 * The list is per-target (`importFrom`), so a harness that cannot take a registry
 * offers none, and the rows carry the SOURCE because two entries can share an id
 * (`kenari` in both omp and opencode).
 */
export async function importableProvidersFor(target: HarnessId): Promise<ImportableProvider[]> {
  const sources = providerFacts(target).importFrom;
  if (sources.length === 0) return [];
  const lists = await Promise.all(sources.map((source) => readRegistryProviders(source)));
  const seen = new Set<string>();
  return lists.flat().filter((entry) => {
    const key = entry.id.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The KEY for one provider, read at import time.
 *
 * Deliberately separate from the list above: this is the only function that
 * touches a credential, and its single caller is the request that writes.
 */
export async function readProviderKey(source: HarnessId, providerId: string): Promise<string | null> {
  const facts = providerFacts(source);
  const text = await readText(registryFilePath(source));
  if (!text || !facts.registry.apiKeyField) return null;
  const doc = parseByKind(facts.registry.kind, text);
  if (!doc) return null;
  if (facts.registry.kind === 'zcode-provider-rules') return readZcodeProviderKey(text, providerId);
  const entry = asRecord(asRecord(atPointer(doc, facts.registry.pointer))[providerId]);
  const value = atPointer(entry, facts.registry.apiKeyField);
  return typeof value === 'string' && value.length > 0 ? value : null;
}
