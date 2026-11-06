/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Updating ONE harness — and refusing where Kabmo must not act.
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
 * moves EVERY part that is behind and none that is current:
 *
 *  - both behind → `npm i -g <adapter>@<latest>` then `claude update`;
 *  - only the CLI → `claude update`, with no adapter install at all;
 *  - only the adapter → the npm install alone.
 *
 * Running both unconditionally was the first shape, and it reinstalled an adapter
 * that was already current while reporting "updated to 0.101.0" about a version
 * that never moved.
 *
 * Every run is a POST that answers plain JSON, not an SSE stream: an npm install
 * of one package, or one `upgrade` subcommand, is seconds rather than the minutes
 * `omp update` and the Kabmo self-update take. If one of these grows long enough
 * to need streaming, it should reuse `updates/apply.ts` rather than grow a second
 * progress protocol here.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { HARNESS_IDS, harnessDescriptor, type HarnessId } from '@/shared/lib/harness/catalog';
import { harnessUpdateFacts, latestSourceFor } from '@/shared/lib/harness/updates';
import { forgetProbe, loadProbes } from '@/server/lib/harness/probe-cache.server';
import { forgetCliVersion, harnessVersionState } from '@/server/lib/harness/update-state.server';
import { planHarnessUpdate } from '@/shared/lib/harness/update-plan';
import { harnessVersionRows } from '@/server/routes/harness/versions';

/** Longest one update may run before it is killed and reported as a timeout. */
const UPDATE_TIMEOUT_MS = 5 * 60_000;

/** The result the UI reports, in the agent's own terms. */
interface HarnessUpdateOutcome {
  success: boolean;
  id: string;
  message: string;
  /** The commands that ran, so the reader can repeat them themselves. */
  command?: string;
  /** The tail of their output — what actually failed, when it failed. */
  output?: string;
}

/** Run a command, capturing its combined output for the report. */
async function run(command: string[], cwd?: string): Promise<{ code: number | null; output: string }> {
  const proc = Bun.spawn({
    cmd: command,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: UPDATE_TIMEOUT_MS,
    env: { ...Bun.env, PAGER: 'cat', FORCE_COLOR: '0' },
    ...(cwd ? { cwd } : {}),
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, output: [stdout, stderr].filter(Boolean).join('\n').trim() };
}

/** The last few lines of a run, which is where a failure explains itself. */
function tail(output: string, lines = 12): string {
  const all = output.split('\n');
  return all.slice(Math.max(0, all.length - lines)).join('\n').trim();
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

  if (facts.kind === 'self') {
    const command = facts.command?.split(' ') ?? [];
    const binary = command[0];
    if (!binary || !Bun.which(binary)) {
      return json({ error: `${label}: \`${binary ?? 'the updater'}\` is not on PATH` }, { status: 400 });
    }
    const result = await run(command);
    const ok = result.code === 0;
    const outcome: HarnessUpdateOutcome = {
      success: ok,
      id: harness,
      message: ok ? `${label} updated` : `${label} update failed (exit ${result.code ?? 'killed'})`,
      command: facts.command,
      ...(result.output ? { output: tail(result.output) } : {}),
    };
    return json(outcome);
  }

  // `npm`: install the package at the version the registry reports NOW, so the
  // number on screen and the install cannot disagree.
  const pkg = latestSourceFor(harness);
  if (!pkg) return json({ error: `${label} has no package to install` }, { status: 400 });

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

  // `harnessVersionState` was read with `force`, so both latest numbers are what
  // the registry serves NOW rather than what the dialog remembered.

  const steps = planHarnessUpdate(label, facts, state, agentVersion);

  if (steps.length === 0) {
    // Nothing to install. Reported as a success the UI can state plainly, rather
    // than running an install that would change nothing.
    const current = [state.agent.version && `adapter ${state.agent.version}`, state.cli?.version && `${facts.cli?.name} ${state.cli.version}`]
      .filter(Boolean)
      .join(', ');
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

  /** Did every step that ran succeed, and what did each print? */
  const outputs: string[] = [];
  let ok = true;
  for (const step of steps) {
    const result = await run(step.argv);
    if (result.output) outputs.push(result.output);
    if (result.code !== 0) {
      ok = false;
      // The first failure ends the run: installing the CLI on top of a failed
      // adapter install would report two outcomes for one broken state.
      break;
    }
  }

  if (ok) {
    // The cached probe describes the binary that WAS installed. Keeping it would
    // report the old version until the TTL (30 min) or a manual re-probe — and
    // measured after a real `npm install`: the row still read 0.100.0 while npm
    // had 0.101.0 on disk, because the running adapter was the previous process.
    await forgetProbe(harness);
    // The CLI's `--version` read has the same problem: it is cached for ten
    // minutes, so the row would keep claiming the old number after it moved.
    if (facts.cli) forgetCliVersion(facts.cli.bin);
  }

  const moved = steps.map((step) => step.part);
  return json({
    success: ok,
    id: harness,
    message: ok
      ? `${label} updated (${moved.join(' + ')}) — check its status to read the new version`
      : `${label} update failed`,
    command: steps.map((step) => step.command).join(' && '),
    ...(outputs.length > 0 ? { output: tail(outputs.join('\n')) } : {}),
  } satisfies HarnessUpdateOutcome);
}

/** GET answers the same rows the versions route does, so a mistake reads plainly. */
export async function loader() {
  return json({ harnesses: await harnessVersionRows() });
}
