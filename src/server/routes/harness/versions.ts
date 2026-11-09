/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Version and update state for EVERY harness, in one read.
 *
 * The About modal answers "what am I running, and what could move?". That used to
 * be two products — Kabmo and omp — and now it is a dozen agents, each installed a
 * different way. So this route reports, per harness:
 *
 *  - `agent` — the ADAPTER: the version the probe reported, and what its own
 *    package on npm now offers.
 *  - `cli` — the CLI underneath an adapter, from its own `--version`, with its
 *    own package's latest version. Two parts, two number lines: `claude` measured
 *    2.1.318 while its ACP adapter was 0.100.0, and moving one does not move the
 *    other.
 *  - `updateAvailable` — true when ANY part is behind, because the update action
 *    moves every part that is behind in one run. Only when the numbers are known
 *    and comparable: `—` is a real answer here, and a fabricated `false` would
 *    claim "up to date" about a harness Kabmo knows nothing about.
 *  - `kind` — how it updates, so the UI says "Updated by `opencode upgrade`"
 *    instead of offering a button that would install a package behind the vendor's
 *    launcher.
 *
 * `force` re-reads npm instead of answering from the process cache; the About
 * modal's "Check again" sets it, and the automatic path does not.
 */

import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import type { LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { HARNESS_IDS, harnessDescriptor, type HarnessId } from '@/shared/lib/harness/catalog';
import { harnessUpdateFacts, type HarnessUpdateFacts } from '@/shared/lib/harness/updates';
import type { HarnessPartRow, HarnessVersionRow } from '@/shared/types/harness-version';
import { loadProbes } from '@/server/lib/harness/probe-cache.server';
import { harnessVersionState, type HarnessVersionState } from '@/server/lib/harness/update-state.server';
import { isNewer } from '@/shared/lib/updates/semver';

/** One part's row, with the comparison the UI is not allowed to guess at. */
function partRow(part: { version: string | null; latest: string | null }): HarnessPartRow {
  return {
    version: part.version,
    latest: part.latest,
    updateAvailable: Boolean(part.version && part.latest) && isNewer(part.latest as string, part.version as string),
  };
}

/** Assemble the wire row from the version state. */
function toRow(
  id: HarnessId,
  label: string,
  kind: HarnessVersionRow['kind'],
  facts: HarnessUpdateFacts | null,
  state: HarnessVersionState,
): HarnessVersionRow {
  const agent = partRow(state.agent);
  const cli = state.cli ? { name: state.cli.name, ...partRow(state.cli) } : null;

  // `—` is a real answer. A comparison needs BOTH numbers, and claiming
  // "up to date" about a harness with no probe would be a fabricated fact.
  const updateAvailable = state.installed && (agent.updateAvailable || Boolean(cli?.updateAvailable));

  let note: string | null = facts?.note ?? null;
  if (!state.installed) note = 'Not installed on this machine — nothing to update.';
  else if (!facts) note = 'Kabmo knows nothing about updating this harness.';
  else if (!state.agent.version) note = 'Not probed yet — check its status to learn the version it runs.';
  else if (facts.kind !== 'npm') note = facts.command ? `Updated by \`${facts.command}\`.` : note;
  // An npm harness can have no AGENT package (`dsh`: the probe reports the ACP
  // surface, the package is the CLI). The note names whichever package was
  // actually read, instead of "Could not read undefined".
  else if (facts.pkg && !state.agent.latest) note = `Could not read ${facts.pkg} from the registry.`;
  else if (facts.cli?.pkg && state.cli?.version && !state.cli.latest) note = `Could not read ${facts.cli.pkg} from the registry.`;

  return {
    id,
    label,
    kind: state.installed ? kind : null,
    installed: state.installed,
    agent,
    cli,
    updateAvailable,
    note,
    // An absent harness has no command to offer: the reader would copy a line
    // that cannot run until the agent exists.
    command: state.installed ? facts?.command ?? null : null,
  };
}

/** Every harness's row, in catalog order. */
export async function harnessVersionRows(force = false): Promise<HarnessVersionRow[]> {
  const probes = await loadProbes();

  return Promise.all(HARNESS_IDS.map(async (id) => {
    const facts = harnessUpdateFacts(id);
    const state = await harnessVersionState(id, probes.get(id)?.capabilities.agentVersion ?? null, force);
    return toRow(id, harnessDescriptor(id)?.label ?? id, facts?.kind ?? null, facts, state);
  }));
}

/** GET /api/harness/versions?force=1 */
export async function loader({ request }: LoaderFunctionArgs) {
  const force = new URL(request.url).searchParams.get('force') === '1';
  return json({ harnesses: await harnessVersionRows(force) }, { headers: NO_STORE_HEADERS });
}
