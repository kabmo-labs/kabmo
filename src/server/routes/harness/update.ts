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
import { loadProbes } from '@/server/lib/harness/probe-cache.server';
import { fetchNpmLatest } from '@/server/lib/updates/npm';
import { harnessVersionRows } from '@/server/routes/harness/versions';
import { forgetProbe } from '@/server/lib/harness/probe-cache.server';

/** Longest one update may run before it is killed and reported as a timeout. */
const UPDATE_TIMEOUT_MS = 5 * 60_000;

/** The result the UI reports, in the agent's own terms. */
interface HarnessUpdateOutcome {
  success: boolean;
  id: string;
  message: string;
  /** The command that ran, so the reader can repeat it themselves. */
  command?: string;
  /** The tail of its output — what actually failed, when it failed. */
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

  let id: unknown;
  try {
    id = ((await request.json()) as { harness?: unknown }).harness;
  } catch {
    return json({ error: 'Request body is not valid JSON' }, { status: 400 });
  }
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
  const latest = await fetchNpmLatest(pkg);
  if (!latest) {
    return json({ error: `Could not read ${pkg} from the registry`, code: 'registry_unreadable' }, { status: 502 });
  }

  const probe = (await loadProbes()).get(harness);
  if (probe?.capabilities.agentVersion && probe.capabilities.agentVersion === latest) {
    // Nothing to install. Reported as a success the UI can state plainly, rather
    // than running an install that would change nothing.
    return json({
      success: true,
      id: harness,
      message: `${label} is already ${latest}`,
    } satisfies HarnessUpdateOutcome);
  }

  const install = await run(['npm', 'install', '-g', `${pkg}@${latest}`]);
  const installOk = install.code === 0;
  const lines = [
    `npm install -g ${pkg}@${latest}`,
  ];
  let output = install.output;

  // The PACKAGE is not always the whole agent. An ACP adapter pins the CLI it
  // bridges (`claude-agent-acp` ↔ `claude`), so moving only the adapter can leave
  // a stale binary underneath. When the harness also names its own updater, that
  // runs too — and its failure is reported, not swallowed.
  const command = facts.command?.split(' ') ?? [];
  let commandOk = true;
  if (installOk && command.length > 0 && Bun.which(command[0] as string)) {
    lines.push(facts.command as string);
    const selfUpdate = await run(command);
    commandOk = selfUpdate.code === 0;
    output = [output, selfUpdate.output].filter(Boolean).join('\n');
  }

  const ok = installOk && commandOk;
  if (ok) {
    // The cached probe describes the binary that WAS installed. Keeping it would
    // report the old version until the TTL (30 min) or a manual re-probe — and
    // measured after a real `npm install`: the row still read 0.100.0 while npm
    // had 0.101.0 on disk, because the running adapter was the previous process.
    await forgetProbe(harness);
  }
  return json({
    success: ok,
    id: harness,
    message: ok
      ? `${label} updated to ${latest} — check its status to read the new version`
      : `${label} update failed${installOk ? '' : ` (npm exit ${install.code ?? 'killed'})`}`,
    command: lines.join(' && '),
    ...(output ? { output: tail(output) } : {}),
  } satisfies HarnessUpdateOutcome);
}

/** GET answers the same rows the versions route does, so a mistake reads plainly. */
export async function loader() {
  return json({ harnesses: await harnessVersionRows() });
}
