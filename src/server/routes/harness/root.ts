/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Harness discovery: which harnesses can run here, and what each one offers.
 *
 * Split from the spawn route because the two answer different questions on
 * different cadences — this one is read by the composer's tab strip and the
 * settings page (cached for the process), while a spawn happens once per chat.
 *
 * Probing spawns agents, so it NEVER runs on a page load: `GET` without
 * `?probe=` answers from the cache (and from the static launch table for
 * anything never probed), and `?probe=<id>` spawns exactly one.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { HARNESS_IDS, harnessDescriptor, type HarnessId } from '@/shared/lib/harness/catalog';
import { HARNESS_LAUNCH, probeHarness } from '@/server/lib/harness/launch';
import type { HarnessProbe } from '@/server/lib/harness/capabilities';
import { forgetProbe, loadProbes, rememberProbe } from '@/server/lib/harness/probe-cache.server';
import { loadHarnessConfig, probeInvalidatedBy, saveHarnessConfig } from '@/server/lib/harness/config.server';
import { importableProvidersFor, readRegistryProviders } from '@/server/lib/harness/provider-sources.server';
import { addProviderAction, importProviderAction, importSourceOf, isImportBody } from '@/server/routes/harness/import-action';
import { supportedProtocols } from '@/shared/lib/harness/dialects';
import {
  credentialFieldLabel,
  providerLevel,
  registryLabel,
} from '@/shared/lib/harness/providers';
import { providerFacts } from '@/shared/lib/harness/provider-facts';
import type { HarnessProviderSupport } from '@/shared/types/harness';
import { parseHarnessConfig, type HarnessConfig } from '@/shared/lib/harness/config';
import { resolveOmpBin } from '@/server/lib/omp/core/cli';

/**
 * The probe cache lives in `probe-cache.server.ts`: the SPAWN reads it too, to
 * resolve a harness's configured default model against what that agent
 * published, and a route must not be an import of the spawn path.
 */

export interface HarnessSummary {
  id: HarnessId;
  label: string;
  transport: 'rpc' | 'acp';
  /** False for `omp-rpc`, which is the built-in path and is always present. */
  canLaunch: boolean;
  /** True for the transport Kabmo itself provides (`omp-rpc`). It is not a
   *  choice, so the settings page omits it — see `installable` on the catalog
   *  descriptor. */
  builtIn?: true;
  install?: string;
  note?: string;
  probe: HarnessProbe | null;
  /** Why it cannot run, without probing: the launch command is missing. */
  unavailable?: string;
}

/** Is a launch command first-token resolvable? The omp binary has its own
 *  resolver (KABMO_OMP_BIN, then PATH) and is never "missing" through PATH alone. */
function commandAvailable(id: HarnessId): boolean {
  if (id === 'omp-acp') return Boolean(resolveOmpBin());
  const launch = HARNESS_LAUNCH[id];
  if (!launch) return false;
  const [binary] = launch.command;
  if (!binary) return false;
  if (binary === 'npx') return Boolean(Bun.which('npx') ?? Bun.which('node'));
  return Boolean(Bun.which(binary));
}

export async function listHarnesses(): Promise<HarnessSummary[]> {
  // ONE read for the whole catalog, from disk when memory is cold: the probe
  // cache used to be process-only, so every restart — every `bun --hot` reload —
  // turned a harness the user had just checked back into `not probed`.
  const stored = await loadProbes();
  return HARNESS_IDS.map((id) => {
    const descriptor = harnessDescriptor(id);
    const launch = HARNESS_LAUNCH[id];
    const cached = stored.get(id) ?? null;
    // A BUILT-IN transport is never represented by a probe. There is no agent to
    // spawn, so `probeHarness` can only answer "no launch command is configured"
    // — and that answer, cached, came back as `capabilities.blocked` and painted
    // a ⚠ over the `omp` tab while DISABLING it, so the default harness could not
    // be selected at all. Measured: `?probe=omp-rpc` wrote exactly that record.
    const fresh = descriptor?.builtIn ? null : cached;
    const available = id === 'omp-rpc' ? true : commandAvailable(id);
    return {
      id,
      label: descriptor?.label ?? id,
      transport: descriptor?.transport ?? 'acp',
      canLaunch: available,
      ...(descriptor?.builtIn ? { builtIn: true as const } : {}),
      ...(launch?.install ? { install: launch.install } : {}),
      ...(launch?.note ? { note: launch.note } : {}),
      probe: fresh,
      ...(available ? {} : { unavailable: `\`${launch?.command[0] ?? id}\` is not installed` }),
    };
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const target = url.searchParams.get('probe');
  if (target) {
    if (!HARNESS_IDS.includes(target as HarnessId)) {
      return json({ error: `Unknown harness: ${target}` }, { status: 400 });
    }
    // Refused, not probed: a built-in transport has nothing to spawn, and the
    // only answer a probe could produce ("no launch command is configured") is a
    // fact about this route, not about omp. Probing it used to mark the DEFAULT
    // tab blocked, which disabled it in the picker.
    if (harnessDescriptor(target)?.builtIn) {
      return json({ error: `${target} is built in and has no agent to probe`, code: 'builtin_not_probeable' }, { status: 400 });
    }
    const cwd = url.searchParams.get('cwd') || process.cwd();
    const probe = await probeHarness(target as HarnessId, cwd);
    await rememberProbe(target as HarnessId, probe);
    return json({ probe });
  }
  // Every harness's per-harness config travels WITH the catalog: the settings
  // card renders its form from this one payload, so opening a card cannot show a
  // stale value the server would then refuse to save.
  const configs: Record<string, HarnessConfig> = {};
  for (const id of HARNESS_IDS) configs[id] = await loadHarnessConfig(id);

  // What each harness can do about OTHER providers, from the MEASURED table: the
  // file, the field names, whether Kabmo may write it, and the credential-free
  // list of entries a copy could take. No credential travels here — the key is
  // read by the request that writes.
  const providerSupportByHarness: Record<string, HarnessProviderSupport> = {};
  for (const id of HARNESS_IDS) {
    const facts = providerFacts(id);
    const level = providerLevel(id);
    if (level === 'none') continue;
    // CUSTOM providers only, and each row names the protocol its SOURCE declares.
    // Whether it can land in THIS harness is not guessed here: it depends on what
    // the endpoint answers, which the import measures at write time. The card
    // states the target's own list once and lets the route refuse by name.
    const targetProtocols = supportedProtocols(facts.registry.kind, facts.envProtocol);
    const importable = await importableProvidersFor(id);
    // The harness's OWN custom providers, so the card lists what is already
    // there: without it an "Add provider" that worked and a form that silently
    // wrote nothing looked identical.
    const configured = await readRegistryProviders(id);
    providerSupportByHarness[id] = {
      level,
      file: facts.registry.file ?? '',
      fileLabel: registryLabel(id),
      summary: facts.summary,
      createsChoice: facts.createsChoice,
      pointer: facts.registry.pointer,
      credentialLabel: credentialFieldLabel(id),
      ...(facts.env ? { env: facts.env } : {}),
      ...(facts.envProtocol ? { envProtocol: facts.envProtocol } : {}),
      protocols: targetProtocols,
      importable,
      configured,
    };
  }

  return json({ harnesses: await listHarnesses(), configs, providerSupport: providerSupportByHarness });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params });
  // The body is UNTRUSTED and every branch below reads a different field, so it
  // is narrowed to a record ONCE. `record` is a real runtime check, not a cast:
  // a request that is not a JSON object falls through to the probe validation
  // and is refused there, which is the same answer it got before.
  const parsed: unknown = await request.json().catch(() => null);
  const body: Record<string, unknown> =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const id = typeof body.probe === 'string' ? body.probe : null;
  if (!id || !HARNESS_IDS.includes(id as HarnessId)) {
    return json({ error: 'probe must name a known harness id' }, { status: 400 });
  }
  // Same refusal as the loader: no agent exists behind a built-in transport, so
  // its "probe" would only cache a `blocked` record over the default tab.
  if (harnessDescriptor(id)?.builtIn) {
    return json({ error: `${id} is built in and has no agent to probe`, code: 'builtin_not_probeable' }, { status: 400 });
  }
  // An IMPORT: copy one provider out of another registry into this harness's.
  // `{ importProvider: { from, id, env? } }`. The credential is read HERE, from
  // the source file, so the list the browser holds never carries one.
  const importBody = body.importProvider;
  if (isImportBody(importBody)) {
    const requestBody = importBody as Record<string, unknown>;
    const sourceId = typeof requestBody.id === 'string' ? requestBody.id : '';
    if (!sourceId) return json({ error: 'importProvider.id is required' }, { status: 400 });
    const source = importSourceOf(requestBody.from);
    if (!source) {
      return json({ error: `No import source named "${String(requestBody.from)}"`, code: 'unknown_source' }, { status: 400 });
    }
    return importProviderAction(id as HarnessId, source, sourceId, requestBody.entry);
  }
  // AN ADD: the same landing path, with the endpoint typed here instead of
  // copied — `{ addProvider: { name, baseUrl, apiKey, protocol?, models? } }`.
  // Both actions go through `applyProvider`: the probe, the protocol choice, the
  // refusal and the env flattening cannot drift between "copy" and "type".
  const addBody = body.addProvider;
  if (isImportBody(addBody)) {
    return addProviderAction(id as HarnessId, addBody);
  }

  // A CONFIG write rides the same route: `{ config: { harness, ...fields } }`.
  // One endpoint for one subject, and the answer carries the saved shape so the
  // card re-renders from what the server actually holds.
  const configBody = body.config;
  if (configBody !== undefined) {
    const saved = parseHarnessConfig(configBody);
    const previous = await loadHarnessConfig(id as HarnessId);
    await saveHarnessConfig(id as HarnessId, saved);
    const probeInvalidated = probeInvalidatedBy(previous, saved);
    if (probeInvalidated) await forgetProbe(id as HarnessId);
    return json({ config: saved, harness: id, probeInvalidated });
  }
  const probe = await probeHarness(
    id as HarnessId,
    typeof body.cwd === 'string' ? body.cwd : process.cwd(),
  );
  await rememberProbe(id as HarnessId, probe);
  return json({ probe });
}

