/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Write a provider into a harness's OWN registry, in that harness's own format.
 *
 * One writer per FORMAT, dispatched by `HARNESS_PROVIDER_FACTS`. The formats are
 * genuinely different, and the differences are the work:
 *
 * | Format | What a provider is |
 * |---|---|
 * | YAML `providers.<slug>` (omp) | `{baseUrl, apiKey, api, models: [{id, name}]}` |
 * | JSON `provider.<id>` (opencode) | `{npm, name, options:{baseURL, apiKey}, models:{<id>:{}}}` |
 * | TOML `model_providers.<id>` (codex) | `{name, base_url, env_key, wire_api}` |
 * | JSON `providers.<id>` (pi) | `{name, baseUrl, api, apiKey, models:[{id}]}` |
 * | TOML `providers.<id>` (kimi) | `{type, base_url, api_key}` |
 * | JSON `modelProviders.<protocol>` (qwen) | an ARRAY of `{id, baseUrl, envKey}` |
 *
 * Five rules apply to all of them, each a way this could silently break an agent:
 *
 *  - **the document is MERGED, never rewritten.** These files hold more than
 *    providers — opencode.json carries plugins, agents, MCP and permissions;
 *    codex config.toml carries the model, approval policy and hooks. Only the
 *    provider's own node is touched.
 *  - **an unparseable file is REFUSED, not repaired.** It is the agent's file, and
 *    guessing what a malformed entry meant is how a working install stops starting.
 *  - **the id is not invented.** An existing key is UPDATED (that is what an
 *    override means to these agents) while a new one is ADDED.
 *  - **a credential already stored wins.** An import brings an endpoint and a
 *    model list; overwriting a key the user set by hand is not what they asked for.
 *  - **the write is atomic and keeps the file's mode**, which for a file holding
 *    an api key means it stays 0600.
 */

import YAML from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

import { writeFileAtomic } from '@/server/lib/fs/atomic-write';
import { withConfigLock } from '@/server/lib/fs/config-lock';
import { providerFacts, type ProviderRegistryKind } from '@/shared/lib/harness/provider-facts';
import { registryFilePath, readProviderKey } from '@/server/lib/harness/provider-sources.server';
import { asRecord, providerEntryFor, type ProviderDraft } from '@/server/lib/harness/provider-entry';
import { ProviderWriteError } from '@/server/lib/harness/provider-write-error';
import type { HarnessId } from '@/shared/lib/harness/catalog';




/** Serialise a document back in its own format. */
function serialise(kind: ProviderRegistryKind, doc: Record<string, unknown>): string {
  switch (kind) {
    case 'yaml-providers': return YAML.stringify(doc);
    case 'toml-model-providers':
    case 'toml-providers': return `${stringifyToml(doc)}\n`;
    default: return `${JSON.stringify(doc, null, 2)}\n`;
  }
}

/** Parse a document in its own format, or throw with the reason. */
function parseDocument(kind: ProviderRegistryKind, text: string, path: string): Record<string, unknown> {
  try {
    const parsed = kind === 'yaml-providers'
      ? YAML.parse(text)
      : kind === 'toml-model-providers' || kind === 'toml-providers'
        ? parseToml(text)
        : JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ProviderWriteError(`${path} is not a document, so it was left untouched`);
    }
    return parsed as Record<string, unknown>;
  } catch (cause) {
    if (cause instanceof ProviderWriteError) throw cause;
    throw new ProviderWriteError(`${path} could not be parsed, so it was left untouched: ${String(cause)}`);
  }
}

/** The map a provider node lives in, created when absent and refused when wrong. */
function providerMap(doc: Record<string, unknown>, pointer: string, path: string): Record<string, unknown> {
  const head = pointer.split('.')[0];
  if (doc[head] !== undefined && (typeof doc[head] !== 'object' || Array.isArray(doc[head]))) {
    throw new ProviderWriteError(`${path}: "${head}" is not an object, so it was left untouched`);
  }
  const map = asRecord(doc[head]);
  doc[head] = map;
  return map;
}

/** A provider id each format accepts as a key. */
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

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
 * Merge ONE provider into a harness's registry.
 *
 * Returns the id written and whether it replaced an entry, so the UI can say
 * "updated" instead of "added" — the same difference the agents make.
 */
export async function writeProvider(
  target: HarnessId,
  draft: ProviderDraft,
): Promise<{ id: string; replaced: boolean; path: string }> {
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
    throw new ProviderWriteError(`"${id}" is not a provider id ${target} accepts (lowercase, digits, . _ -)`);
  }

  const kind = facts.registry.kind;
  return withConfigLock(path, async () => {
    const file = Bun.file(path);
    const raw = (await file.exists()) ? await file.text() : '';
    const doc = raw.trim() ? parseDocument(kind, raw, path) : {};

    if (kind === 'json-model-providers') {
      // Array-per-protocol: the protocol key is the bucket, and a row is a model.
      const groups = providerMap(doc, facts.registry.pointer, path);
      const protocol = asRecord(groups)[id] === undefined ? 'openai' : String(id);
      const list = Array.isArray(groups[protocol]) ? (groups[protocol] as unknown[]) : [];
      const incoming = providerEntryFor(kind, draft);
      const index = list.findIndex((entry) => asRecord(entry).id === incoming.id);
      const replaced = index >= 0;
      if (replaced) list[index] = { ...asRecord(list[index]), ...incoming };
      else list.push(incoming);
      groups[protocol] = list;
      await writeFileAtomic(path, serialise(kind, doc), { createMode: 0o600 });
      return { id, replaced, path };
    }

    const providers = providerMap(doc, facts.registry.pointer, path);
    const replaced = Object.prototype.hasOwnProperty.call(providers, id);
    const existing = asRecord(providers[id]);
    const incoming = providerEntryFor(kind, draft);
    // The user's own choices win over the import's defaults; the import still
    // brings the endpoint and the model rows.
    const merged = {
      ...incoming,
      ...(replaced ? pickExisting(existing, incoming) : {}),
    };
    providers[id] = merged;
    await writeFileAtomic(path, serialise(kind, doc), { createMode: 0o600 });
    return { id, replaced, path };
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

/**
 * The draft for importing `source`'s provider into a target.
 *
 * `readProviderKey` is called HERE, and only here: the list the browser holds has
 * a boolean `hasKey`, never the credential.
 */
export async function draftForImport(
  source: HarnessId,
  providerId: string,
  listed: { id: string; name: string; baseUrl?: string; dialect?: string; models: string[] },
): Promise<ProviderDraft> {
  const apiKey = await readProviderKey(source, providerId);
  return {
    id: listed.id,
    name: listed.name,
    ...(listed.baseUrl ? { baseUrl: listed.baseUrl } : {}),
    ...(listed.dialect ? { dialect: listed.dialect } : {}),
    models: listed.models,
    ...(apiKey ? { apiKey } : {}),
  };
}

/** Re-exported so a caller imports one module for a write. */
export { ProviderWriteError, providerEntryFor };
export type { ProviderDraft };
