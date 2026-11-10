/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Updating ONE harness — as a BACKGROUND job, and refusing where Kabmo must not act.
 *
 * Three mechanisms, and the refusal is as much of the feature as the button:
 *
 *  - **`npm`** — install that package at the version the registry reported. This is
 *    the only case where Kabmo touches an install, and it is the case the vendor
 *    published for exactly this.
 *  - **`self`** — the CLI updates itself (`opencode upgrade`, `cmd update`). Kabmo
 *    runs THAT command: it must not install a package behind launcher logic it
 *    does not own.
 *  - **`own`** — a vendor installer (curl script, app bundle). Refused with the
 *    reason, because replacing it would be Kabmo guessing at an install it did not
 *    make.
 *
 * **An adapter is TWO installs.** `claude` is `@agentclientprotocol/claude-agent-acp`
 * (the number the probe reports) on top of the `claude` CLI, and they move
 * independently — measured here: adapter 0.100.0 under CLI 2.1.318. So one press
 * moves EVERY part that is behind and none that is current. The decision itself
 * is pure (`planHarnessUpdate`); this route only resolves the facts it needs and
 * hands the argv to the worker.
 *
 * **The route does not run the installs.** They used to run here, inside the POST:
 * the request stayed open for minutes, a reload forgot the run, and a five-minute
 * child timeout could kill `npm install -g` halfway through writing a package
 * tree — the corruption this design removes. The run is a detached worker
 * (`update-worker.ts`) that writes progress to `harness-update.json`; this route
 * answers `202` in milliseconds and `GET /api/harness/update/status` reports the
 * outcome. A second press while one runs is a `409`, read from that same record,
 * so a reloaded page cannot start a competing install.
 */

import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { HARNESS_IDS, harnessDescriptor, type HarnessId } from '@/shared/lib/harness/catalog';
import { harnessUpdateFacts, latestSourceFor } from '@/shared/lib/harness/updates';
import { loadProbes } from '@/server/lib/harness/probe-cache.server';
import { harnessVersionState, type HarnessVersionState } from '@/server/lib/harness/update-state.server';
import { planHarnessUpdate, type HarnessUpdateStep } from '@/shared/lib/harness/update-plan';
import { resolveOmpBin } from '@/server/lib/omp/core/cli';
import {
  startHarnessUpdateJob,
  unfinishedUpdateJob,
} from '@/server/lib/harness/update-job.server';
import { jobQueued } from '@/shared/lib/harness/update-job';

/** The answer to a press that has nothing to move, still plain JSON. */
interface HarnessUpdateOutcome {
  success: boolean;
  id: string;
  message: string;
}

/** A readable description of the numbers currently on disk, for "already current". */
function currentParts(state: HarnessVersionState, cliName: string | undefined): string {
  return [
    state.agent.version && `adapter ${state.agent.version}`,
    state.cli?.version && `${cliName ?? 'CLI'} ${state.cli.version}`,
  ].filter(Boolean).join(', ');
}

/**
 * The argv for a `self` harness: the vendor's own updater, resolved by name.
 *
 * `omp` has its own resolver (`KABMO_OMP_BIN`, then PATH): a custom install is
 * launchable and already reported as installed, so checking PATH alone refused
 * the one updater the harness actually has.
 */
function selfSteps(harness: HarnessId, label: string, command: string): { steps: HarnessUpdateStep[]; error?: string } {
  const argv = command.split(' ');
  const binary = argv[0];
  const resolved = harness === 'omp-acp' ? resolveOmpBin() : binary ? Bun.which(binary) : null;
  if (!binary || !resolved) {
    return { steps: [], error: `${label}: \`${binary || 'the updater'}\` is not on PATH` };
  }
  return { steps: [{ part: label, command, argv: [resolved, ...argv.slice(1)] }] };
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body is not valid JSON' }, { status: 400 });
  }
  const id = body && typeof body === 'object' && 'harness' in body ? body.harness : undefined;
  if (typeof id !== 'string' || !HARNESS_IDS.includes(id as HarnessId)) {
    return json({ error: 'Unknown harness' }, { status: 400 });
  }

  const harness = id as HarnessId;
  const facts = harnessUpdateFacts(harness);
  const label = harnessDescriptor(harness)?.label ?? harness;
  if (!facts) {
    return json({ error: `Kabmo knows nothing about updating ${label}` }, { status: 400 });
  }

  if (facts.kind === 'own') {
    // Refused, with the reason: a vendor installer owns this binary, and Kabmo
    // replacing it would be an install it did not make.
    return json({
      error: `${label} is installed by its vendor` + (facts.command ? `. Update it with: ${facts.command}` : ''),
      code: 'vendor_managed',
    }, { status: 400 });
  }

  // Read BEFORE planning: the answer to a press must not depend on what this
  // press would have planned, and planning reads the npm registry.
  //
  // Only THIS harness's own unfinished record refuses the press. A different
  // harness is ACCEPTED and queued: one install runs at a time (they share the
  // global npm prefix), but "update these two" is one decision the user gets to
  // make, and the queue is what makes the second press work instead of 409.
  const running = await unfinishedUpdateJob(harness);
  if (running) {
    return json({
      error: `${running.label} update is already ${jobQueued(running) ? 'queued' : 'running'} — it continues in the background`,
      job: running,
    }, { status: 409, headers: NO_STORE_HEADERS });
  }

  if (facts.kind === 'self') {
    if (!facts.command) return json({ error: `${label} names no updater command` }, { status: 400 });
    const { steps, error } = selfSteps(harness, label, facts.command);
    if (error) return json({ error }, { status: 400 });
    const job = await startHarnessUpdateJob(harness, label, steps);
    return json({ started: true, queued: jobQueued(job), job }, { status: 202, headers: NO_STORE_HEADERS });
  }

  // `npm`: install the package at the version the registry reports NOW, so the
  // number on screen and the install cannot disagree. A harness can have no
  // AGENT package while its CLI has one (`dsh`): the CLI step is then the whole
  // update, so the missing agent package is not a refusal.
  const pkg = latestSourceFor(harness);
  if (!pkg && !facts.cli?.pkg) return json({ error: `${label} has no package to install` }, { status: 400 });

  const probe = (await loadProbes()).get(harness);
  const agentVersion = probe?.capabilities.agentVersion ?? null;
  // A forced read: this press must install the newest published version, not one
  // remembered from ten minutes ago.
  const state = await harnessVersionState(harness, agentVersion, true);
  if (!state.installed) {
    // A partial install (the CLI present, the adapter absent) reaches here, and an
    // update that cannot see the binary must say so rather than run an install
    // whose result the row could never report.
    return json({ error: `${label} is not installed on this machine` }, { status: 400 });
  }

  const steps = planHarnessUpdate(label, facts, state, agentVersion);

  if (steps.length === 0) {
    // Nothing to install. Reported as a success the UI can state plainly, rather
    // than running an install that would change nothing.
    const current = currentParts(state, facts.cli?.name);
    return json({
      success: true,
      id: harness,
      // Without a probe there was no number to compare, so the honest answer is
      // that nothing was compared — not "up to date".
      message: agentVersion
        ? `${label} is already up to date${current ? ` (${current})` : ''}`
        : `${label} has never been probed — nothing could be compared`,
    } satisfies HarnessUpdateOutcome);
  }

  const job = await startHarnessUpdateJob(harness, label, steps);
  return json({ started: true, queued: jobQueued(job), job }, { status: 202, headers: NO_STORE_HEADERS });
}
