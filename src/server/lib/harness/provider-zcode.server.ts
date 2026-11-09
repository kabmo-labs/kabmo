/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * ZCode's personal providers: `~/.zcode/v2/provider_config.json` (3.12+).
 *
 * The shape is a RULE GRAPH, not the map every other registry uses:
 *
 * ```json
 * { "schemaVersion": 1,
 *   "config": {
 *     "providerConfigRules": { "providerRules": [ { "providerId", "providerName", "config": {
 *       "access": { "type": "api-key", "apiKey" },
 *       "api": { "type": "openai-chat-completions", "baseUrl" } } } ] },
 *     "modelConfigRules": {
 *       "providerModelRules": [ { "providerId", "modelId", "config": { "enabled": true } } ],
 *       "manualProviderModelRules": [] } } }
 * ```
 *
 * Two measured reasons the file is written carefully:
 *
 *  - **A provider alone serves nothing.** The bridge builds its dropdown from
 *    the MODEL rules (`loadPersonalModels` reads `modelConfigRules` only), so a
 *    provider rule without a model rule is invisible. The writer therefore emits
 *    one rule per model id, beside the provider.
 *  - **The top level is strict.** `schemaVersion` and `config` are the only keys
 *    the backend accepts; everything inside `config` is carried through
 *    untouched. This writer merges exactly what it owns and preserves the rest,
 *    including manual model rules and the user's own headers.
 *
 * `~/.zcode/v2/config.json` is deliberately NOT touched: it is the desktop app's
 * legacy provider map and its credentials. Personal providers belong in the file
 * this module owns.
 */

import { withConfigLock } from '@/server/lib/fs/config-lock';
import { writeFileAtomic } from '@/server/lib/fs/atomic-write';
import { asRecord, type ProviderDraft } from '@/server/lib/harness/provider-entry';
import { ProviderWriteError } from '@/server/lib/harness/provider-write-error';
import { protocolOfSourceDialect } from '@/shared/lib/harness/dialects';
import type { ImportableProvider } from '@/server/lib/harness/provider-sources.server';
import type { ProviderWriteResult } from '@/server/lib/harness/provider-write.server';

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : [];
}

function ruleProviderId(rule: Record<string, unknown>): string {
  return typeof rule.providerId === 'string' ? rule.providerId : '';
}

/** The provider rules and both model-rule arrays, created when absent. */
function ruleTables(doc: Record<string, unknown>): {
  providers: unknown[];
  smart: unknown[];
  manual: unknown[];
} {
  const config = asRecord(doc.config);
  doc.config = config;
  const providerConfigRules = asRecord(config.providerConfigRules);
  config.providerConfigRules = providerConfigRules;
  const modelConfigRules = asRecord(config.modelConfigRules);
  config.modelConfigRules = modelConfigRules;
  const providers = Array.isArray(providerConfigRules.providerRules) ? providerConfigRules.providerRules : [];
  providerConfigRules.providerRules = providers;
  const smart = Array.isArray(modelConfigRules.providerModelRules) ? modelConfigRules.providerModelRules : [];
  modelConfigRules.providerModelRules = smart;
  const manual = Array.isArray(modelConfigRules.manualProviderModelRules) ? modelConfigRules.manualProviderModelRules : [];
  modelConfigRules.manualProviderModelRules = manual;
  return { providers, smart, manual };
}

/** Model ids declared by BOTH rule arrays for one provider, in file order. */
function ruleModelIds(doc: Record<string, unknown>, providerId: string): string[] {
  const { smart, manual } = ruleTables(doc);
  const out: string[] = [];
  for (const rule of [...smart, ...manual]) {
    const entry = asRecord(rule);
    if (ruleProviderId(entry) !== providerId) continue;
    const modelId = typeof entry.modelId === 'string' ? entry.modelId : '';
    if (!modelId || asRecord(entry.config).enabled === false) continue;
    if (!out.includes(modelId)) out.push(modelId);
  }
  return out;
}

/** Context windows a smart/manual model rule declares. */
function ruleContextWindows(doc: Record<string, unknown>): Record<string, number> {
  const { smart, manual } = ruleTables(doc);
  const out: Record<string, number> = {};
  for (const rule of [...smart, ...manual]) {
    const entry = asRecord(rule);
    const providerId = ruleProviderId(entry);
    const modelId = typeof entry.modelId === 'string' ? entry.modelId : '';
    const size = asRecord(asRecord(entry.config).properties).contextWindow;
    if (providerId && modelId && typeof size === 'number' && size > 0) out[`${providerId}/${modelId}`] = size;
  }
  return out;
}

/**
 * Every custom provider the file holds, credential-free.
 *
 * A malformed document yields nothing: this reader feeds a settings card, and
 * refusing to draw the page over the agent's own broken file would hide the only
 * place that can explain it.
 */
export function readZcodeProviders(text: string | null, source: ImportableProvider['source']): ImportableProvider[] {
  if (!text) return [];
  let doc: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    doc = parsed as Record<string, unknown>;
  } catch {
    return [];
  }
  const { providers } = ruleTables(doc);
  const windows = ruleContextWindows(doc);
  const out: ImportableProvider[] = [];
  for (const raw of providers) {
    const rule = asRecord(raw);
    const id = ruleProviderId(rule);
    if (!id || id.startsWith('builtin:') || id.startsWith('account:')) continue;
    const config = asRecord(rule.config);
    const access = asRecord(config.access);
    const api = asRecord(config.api);
    const dialect = typeof api.type === 'string' ? api.type : undefined;
    const protocol = protocolOfSourceDialect(dialect);
    const models = [...ruleModelIds(doc, id)];
    for (const declared of stringList(config.personalModelIds)) {
      if (!models.includes(declared)) models.push(declared);
    }
    const contextWindow = Object.fromEntries(
      models.flatMap((modelId) => {
        const size = windows[`${id}/${modelId}`];
        return size ? [[modelId, size]] : [];
      }),
    );
    out.push({
      id,
      name: typeof rule.providerName === 'string' && rule.providerName.trim() ? rule.providerName : id,
      ...(typeof api.baseUrl === 'string' && api.baseUrl ? { baseUrl: api.baseUrl } : {}),
      ...(dialect ? { dialect } : {}),
      ...(protocol ? { protocol } : {}),
      models,
      ...(Object.keys(contextWindow).length > 0 ? { contextWindow } : {}),
      source,
      hasKey: typeof access.apiKey === 'string' && access.apiKey.length > 0,
    });
  }
  return out;
}

/** One provider's credential, read only by the request that writes a target. */
export function readZcodeProviderKey(text: string | null, providerId: string): string | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const { providers } = ruleTables(parsed as Record<string, unknown>);
    const rule = providers.map(asRecord).find((entry) => ruleProviderId(entry) === providerId);
    const key = asRecord(asRecord(rule?.config).access).apiKey;
    return typeof key === 'string' && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/** An empty document in the file's canonical shape. */
function emptyDocument(): Record<string, unknown> {
  const doc: Record<string, unknown> = { schemaVersion: 1 };
  ruleTables(doc);
  return doc;
}

function union(first: string[], second: string[]): string[] {
  const out = [...first];
  for (const entry of second) if (entry && !out.includes(entry)) out.push(entry);
  return out;
}

/**
 * Merge ONE provider (and its model rules) into the personal provider file.
 *
 * Fields this writer does not own survive: headers, `apiKeyManagementUrl`,
 * `logo`, `templateId`, a manual model rule's capability block, `providerOrder`
 * and `defaultModelSelection`. A stored credential is kept when the draft brings
 * none, the same rule every other writer follows.
 */
export async function writeZcodeProvider(input: {
  path: string;
  id: string;
  draft: ProviderDraft;
  dialect: string;
}): Promise<ProviderWriteResult> {
  const { path, id, draft, dialect } = input;
  // The runtime's own writer locks a DIRECTORY at `${path}.lock` (its
  // `file-lock.ts`), so a file at that exact path would look like a lock it
  // must reclaim. Kabmo serialises its own writers on a distinct lease and the
  // final rename stays atomic; the app's poll picks the write up.
  return withConfigLock(`${path}.kabmo`, async () => {
    const file = Bun.file(path);
    const raw = (await file.exists()) ? await file.text() : '';
    let doc: Record<string, unknown>;
    if (raw.trim()) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a document');
        doc = parsed as Record<string, unknown>;
      } catch (cause) {
        throw new ProviderWriteError(`${path} could not be parsed, so it was left untouched: ${String(cause)}`);
      }
    } else {
      doc = emptyDocument();
    }
    if (typeof doc.schemaVersion !== 'number') doc.schemaVersion = 1;

    const { providers, smart, manual } = ruleTables(doc);
    const index = providers.findIndex((rule) => ruleProviderId(asRecord(rule)) === id);
    const existing = index >= 0 ? asRecord(providers[index]) : {};
    const existingConfig = asRecord(existing.config);
    const existingAccess = asRecord(existingConfig.access);
    const existingApi = asRecord(existingConfig.api);
    const baseUrl = draft.baseUrl?.trim() || (typeof existingApi.baseUrl === 'string' ? existingApi.baseUrl : '');
    if (!baseUrl) {
      throw new ProviderWriteError(
        `ZCode needs a base URL for "${id}": a standalone personal provider has no inherited endpoint.`,
      );
    }
    const apiKey = draft.apiKey?.trim();
    const models = union(stringList(existingConfig.personalModelIds), draft.models);
    const rule = {
      ...existing,
      providerId: id,
      providerName: draft.name || (typeof existing.providerName === 'string' ? existing.providerName : id),
      enabled: true,
      config: {
        ...existingConfig,
        group: typeof existingConfig.group === 'string' ? existingConfig.group : 'standard-personal',
        visibility: 'visible',
        access: {
          ...existingAccess,
          type: apiKey ? 'api-key' : (typeof existingAccess.type === 'string' ? existingAccess.type : 'api-key'),
          ...(apiKey ? { apiKey } : {}),
        },
        api: { ...existingApi, type: dialect, baseUrl },
        personalModelIds: models,
        modelOrder: union(stringList(existingConfig.modelOrder), models),
      },
    };
    if (index >= 0) providers[index] = rule;
    else providers.push(rule);

    // One model rule per id: a provider rule with no model rule is invisible to
    // the dropdown (see the module header). Existing rules are updated in place,
    // and a MANUAL rule stays manual — moving it would drop the capability block
    // the user configured by hand.
    let addedRules = 0;
    for (const modelId of models) {
      const contextWindow = draft.contextWindow?.[modelId];
      const manualIndex = manual.findIndex((entry) => {
        const row = asRecord(entry);
        return ruleProviderId(row) === id && row.modelId === modelId;
      });
      const smartIndex = smart.findIndex((entry) => {
        const row = asRecord(entry);
        return ruleProviderId(row) === id && row.modelId === modelId;
      });
      const target = manualIndex >= 0 ? manual : smartIndex >= 0 ? smart : null;
      const at = manualIndex >= 0 ? manualIndex : smartIndex;
      if (target) {
        const row = asRecord(target[at]);
        const config = asRecord(row.config);
        const properties = asRecord(config.properties);
        target[at] = {
          ...row,
          config: {
            ...config,
            enabled: true,
            ...(contextWindow && typeof properties.contextWindow !== 'number'
              ? { properties: { ...properties, contextWindow } }
              : {}),
          },
        };
        continue;
      }
      smart.push({
        providerId: id,
        modelId,
        config: {
          enabled: true,
          ...(contextWindow ? { properties: { contextWindow } } : {}),
          // A custom model has no catalog entry, so WITHOUT an explicit map the
          // runtime inherits a family rule (measured: a `qwen3-…` id inherited
          // `enable_thinking` + `thinking` + `reasoning_effort`, and the gateway
          // answered 400 for every turn). The catalog's own generic rule maps no
          // reasoning parameters; copying it keeps an unknown endpoint usable and
          // never sends a field the endpoint did not advertise.
          optionSpecs: { reasoningLevel: { values: ['disabled', 'enabled'], map: '{}' } },
        },
      });
      addedRules += 1;
    }

    const text = JSON.stringify(doc, null, 2);
    await writeFileAtomic(path, text, { createMode: 0o600 });
    const notes: string[] = [
      `Wrote ${models.length} model rule${models.length === 1 ? '' : 's'} into provider_config.json — ZCode lists a custom provider’s models from that table, not from the provider rule alone.`,
    ];
    if (draft.models.length === 0) {
      notes.push('No model ids were given, so this provider serves nothing until one is added.');
    }
    if (addedRules > 0) {
      notes.push('New model rules map NO reasoning parameters: the runtime otherwise inherits a catalog family mapping (measured: `enable_thinking`), which a custom endpoint can reject with 400. An existing rule keeps its own mapping.');
    }
    if (!apiKey && typeof existingAccess.apiKey === 'string' && existingAccess.apiKey) {
      notes.push('Kept the stored API key — the draft carried none.');
    }
    return { id, replaced: index >= 0, path, dialect, env: {}, notes };
  });
}
