/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Add a provider to ONE harness — the same landing path an import takes, with the
 * endpoint and credential typed instead of copied.
 *
 * The split is deliberate: `import` answers "copy what another agent already
 * has", `add` answers "here is a gateway I use". Everything AFTER that is the
 * same problem, so it is one function (`applyProvider`):
 *
 *  1. **Measure the endpoint** (`probeEndpointProtocols`). A user knows their
 *     gateway and rarely knows which wire API it answers; the probe asks, with no
 *     credential, so it is safe before the key is validated.
 *  2. **Pick a protocol this target speaks** — the measured one, else the one
 *     declared, else refuse BY NAME of both sides.
 *  3. **Write** into the harness's own registry, or flatten into its env when it
 *     has none, and return what landed.
 *
 * Split from the route so the two actions read as sentences, and so the only
 * module that touches a credential is this one.
 */

import { json } from '@/server/lib/remix-compat';
import { HARNESS_IDS, type HarnessId } from '@/shared/lib/harness/catalog';
import { adaptBaseUrl, planProtocol, supportedProtocols, type CanonicalProtocol } from '@/shared/lib/harness/dialects';
import { providerFacts } from '@/shared/lib/harness/provider-facts';
import { providerEnv, providerLevel, registryLabel } from '@/shared/lib/harness/providers';
import { providerIdProblem, providerSlugFrom } from '@/shared/lib/harness/provider-slug';
import { withEnvValues } from '@/shared/lib/harness/config';
import { loadHarnessConfig, saveHarnessConfig } from '@/server/lib/harness/config.server';
import { forgetProbe } from '@/server/lib/harness/probe-cache.server';
import { probeEndpointProtocols, type EndpointProbe } from '@/server/lib/harness/provider-probe.server';
import { writeProvider, type ListedProvider, type ProviderDraft } from '@/server/lib/harness/provider-write.server';
import { readProviderKey } from '@/server/lib/harness/provider-sources.server';

/** A provider about to be written, from any source. */
interface Candidate extends ListedProvider {
  /** The credential, when the caller has it (an add). An import reads its own. */
  apiKey?: string;
}

/**
 * The model a pin should name, from the source's own list.
 *
 * An `environment` harness has ONE model variable, so it needs one id — and the
 * source's first is rarely the right one. Measured against kenari: the list
 * starts with `agnes-2-5-flash:free`, for which Claude Code logged
 * `unrecognized_model`, and with NO model pinned at all it answered an empty
 * turn. A Sonnet id is Claude Code's own default family and was the one that
 * completed a turn, so the newest Sonnet wins; then any `claude-*`; then first.
 */
function pinnedModel(protocol: CanonicalProtocol, models: readonly string[]): string | undefined {
  if (models.length === 0) return undefined;
  if (protocol !== 'anthropic-messages') return models[0];
  const sonnets = models.filter((id) => /^claude[-.]sonnet/i.test(id));
  if (sonnets.length > 0) return sonnets.reduce((best, id) => (versionOf(id) > versionOf(best) ? id : best));
  return models.find((id) => /^claude[-.]/i.test(id)) ?? models[0];
}

/** `claude-sonnet-5` → 5, `claude-sonnet-4-6` → 4.6; anything else → 0. */
function versionOf(id: string): number {
  const match = /(\d+)(?:[-.](\d+))?/.exec(id.replace(/^claude[-.]sonnet[-.]?/i, ''));
  if (!match) return 0;
  return Number(match[1]) + Number(match[2] ?? 0) / 100;
}

/**
 * The refusal for "no protocol both ends speak", naming what each side said.
 *
 * The endpoint's answer is included because it is the fact that makes the message
 * actionable: "antigravity takes google-genai; this host answers openai-chat,
 * anthropic-messages" tells the reader the provider is real and the agent is the
 * constraint.
 */
function noSharedProtocol(
  target: HarnessId,
  id: string,
  declared: CanonicalProtocol | undefined,
  accepted: readonly CanonicalProtocol[],
  probe: EndpointProbe | null,
  sourceLabel: string,
) {
  const answers = probe?.protocols.length ? ` and the endpoint answers ${probe.protocols.join(', ')}` : '';
  return json({
    error: `${target} has no protocol "${id}" can land on. ${sourceLabel} declares `
      + `${declared ?? 'no dialect'}${answers}; ${target} accepts ${accepted.join(', ') || 'no provider protocols'}.`,
    code: 'no_shared_protocol',
    probe,
  }, { status: 400 });
}

/**
 * Measure, choose, and write ONE provider into `target`.
 *
 * `sourceLabel` names where the provider came from ("models.yml (omp)" for an
 * import, "this form" for an add) so a refusal points at the right thing.
 */
export async function applyProvider(target: HarnessId, candidate: Candidate, sourceLabel: string) {
  const facts = providerFacts(target);
  const accepted = supportedProtocols(facts.registry.kind, facts.envProtocol);
  const level = providerLevel(target);

  if (level !== 'full' && level !== 'environment') {
    return json({
      error: `${target} has no provider registry Kabmo can write — use its launch command and env`,
      code: 'no_registry',
    }, { status: 400 });
  }

  // MEASURE before writing. A probe sends no credential — it asks the HOST a
  // question — so it is safe on a provider whose key is unset, and it is skipped
  // when there is no endpoint to ask.
  const probe = candidate.baseUrl ? await probeEndpointProtocols(candidate.baseUrl) : null;
  const measured = accepted.find((protocol) => probe?.protocols.includes(protocol)) ?? null;
  // A probe that REACHED the host is evidence: when it answers nothing this
  // target speaks, the answer is no — falling back to "the target has only one
  // protocol, so use it" would write a provider the endpoint never agreed to
  // (measured: codex is Responses-only, a Chat-only gateway 404s `/v1/responses`).
  // The fallback stays for the case that has no evidence at all: no endpoint, or
  // a probe that could not be made.
  const evidenceSaysNo = probe !== null && !probe.error && probe.findings.length > 0;
  const planned = measured
    ?? (evidenceSaysNo ? null : planProtocol(candidate.protocol ?? null, accepted));
  if (!planned) {
    return noSharedProtocol(target, candidate.id, candidate.protocol, accepted, probe, sourceLabel);
  }

  const draft: ProviderDraft = {
    id: candidate.id,
    name: candidate.name,
    ...(candidate.baseUrl ? { baseUrl: candidate.baseUrl } : {}),
    protocol: planned,
    models: candidate.models,
    ...(candidate.contextWindow ? { contextWindow: candidate.contextWindow } : {}),
    ...(candidate.apiKey ? { apiKey: candidate.apiKey } : {}),
  };

  if (level === 'full') {
    try {
      const written = await writeProvider(target, draft);
      // A variable-name format (codex's `env_key`) stores ONLY the name, so the
      // value is saved into the harness env — where the spawn reads it — and the
      // probe is dropped because the env is part of what it measured.
      let config = null;
      if (Object.keys(written.env).length > 0) {
        config = withEnvValues(await loadHarnessConfig(target), written.env);
        await saveHarnessConfig(target, config);
        await forgetProbe(target);
      }
      return json({
        imported: written,
        harness: target,
        target: registryLabel(target),
        protocol: planned,
        probe,
        ...(config ? { config } : {}),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not write the registry';
      return json({ error: message, probe }, { status: 400 });
    }
  }

  // environment: the same fields FLATTENED into the vars that agent reads. There
  // is no registry, so this REPLACES its endpoint. The base URL is the HOST ROOT
  // — measured, Claude Code appends `/v1/messages` itself and answered an empty
  // turn against `https://kenari.id/v1`.
  const env = providerEnv(target, {
    baseUrl: adaptBaseUrl(draft.baseUrl ?? '', 'root'),
    apiKey: draft.apiKey ?? '',
    ...(pinnedModel(planned, draft.models) ? { model: pinnedModel(planned, draft.models)! } : {}),
  });
  if (Object.keys(env).length === 0) {
    return json({ error: `Nothing to write: "${candidate.id}" has no endpoint or key.` }, { status: 400 });
  }
  const saved = withEnvValues(await loadHarnessConfig(target), env);
  await saveHarnessConfig(target, saved);
  await forgetProbe(target);
  return json({
    config: saved,
    harness: target,
    envWritten: Object.keys(env),
    protocol: planned,
    probe,
    provider: candidate.id,
  });
}

/** The request's own fields, narrowed once because every one of them is untrusted. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * `{ addProvider: { name, baseUrl, apiKey, protocol?, models? } }`.
 *
 * The id is DERIVED from the name with the same function the form previews with
 * (`providerSlugFrom`), so what the reader sees under the field is exactly the
 * key that lands in the file. An explicit `id` is honoured when it passes the
 * shared pattern — a provider the user already names in their own registry
 * should not be renamed by a slug rule.
 */
export async function addProviderAction(target: HarnessId, body: unknown) {
  const request = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const name = typeof request.name === 'string' ? request.name.trim() : '';
  const explicitId = typeof request.id === 'string' ? request.id.trim().toLowerCase() : '';
  const id = explicitId || providerSlugFrom(name);
  const problem = providerIdProblem(id);
  if (problem) return json({ error: problem }, { status: 400 });
  if (!name) return json({ error: 'A provider needs a name.' }, { status: 400 });

  const baseUrl = typeof request.baseUrl === 'string' ? request.baseUrl.trim() : '';
  const apiKey = typeof request.apiKey === 'string' ? request.apiKey.trim() : '';
  const protocol = typeof request.protocol === 'string' ? (request.protocol as CanonicalProtocol) : undefined;
  const models = stringList(request.models).map((entry) => entry.trim()).filter(Boolean);

  // An env harness has no file to hold an endpoint, and no models of its own:
  // the probe picks the protocol, and `pinnedModel` names the one model variable.
  return applyProvider(target, { id, name, baseUrl, apiKey, models, ...(protocol ? { protocol } : {}) }, 'this form');
}

/** Handle one import request. `source` and `id` are already validated. */
export async function importProviderAction(
  target: HarnessId,
  source: HarnessId,
  sourceId: string,
  entry: unknown,
) {
  const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
  const windows = record.contextWindow;
  const listed: Candidate = {
    id: sourceId,
    name: typeof record.name === 'string' ? record.name : sourceId,
    ...(typeof record.baseUrl === 'string' ? { baseUrl: record.baseUrl } : {}),
    ...(typeof record.protocol === 'string' ? { protocol: record.protocol as CanonicalProtocol } : {}),
    models: stringList(record.models),
    ...(windows && typeof windows === 'object' ? { contextWindow: windows as Record<string, number> } : {}),
  };
  // The KEY is read HERE, from the source file, in the request that writes: the
  // list the browser holds carries a boolean `hasKey`, never the value.
  const key = await readProviderKey(source, sourceId);
  return applyProvider(target, { ...listed, ...(key ? { apiKey: key } : {}) }, registryLabel(source));
}

/** True when the body carries an import request this module should answer. */
export function isImportBody(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** A source id the import may read from. Refuses before any file is touched. */
export function importSourceOf(value: unknown): HarnessId | null {
  return typeof value === 'string' && HARNESS_IDS.includes(value as HarnessId)
    ? (value as HarnessId)
    : null;
}
