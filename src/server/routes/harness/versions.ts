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
 *  - `current` — what the AGENT said its version is, from the probe. Not read from
 *    a file, not inferred: `initialize` answers `agentInfo`, and a harness that has
 *    never been probed has no version to report.
 *  - `latest` — what the INSTALL SOURCE would move to. Only an `npm` harness has
 *    one (`latestSourceFor`): asking npm about a self-updating CLI would invent a
 *    discrepancy between two different number lines.
 *  - `updateAvailable` — only when both numbers are known and comparable. `—` is a
 *    real answer here; a fabricated `false` would claim "up to date" about a
 *    harness Kabmo knows nothing about.
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
import { harnessUpdateFacts, latestSourceFor, type HarnessUpdateKind } from '@/shared/lib/harness/updates';
import { loadProbes } from '@/server/lib/harness/probe-cache.server';
import { HARNESS_LAUNCH } from '@/server/lib/harness/launch';
import { resolveOmpBin } from '@/server/lib/omp/core/cli';
import { fetchNpmLatest } from '@/server/lib/updates/npm';
import { isNewer } from '@/shared/lib/updates/semver';

export interface HarnessVersionRow {
  id: HarnessId;
  label: string;
  kind: HarnessUpdateKind | null;
  /** The version the agent reported — for an adapter, that is the ADAPTER's. */
  agentVersion: string | null;
  /** The CLI underneath an adapter, read from its own `--version`. Null when the
   *  harness is not an adapter, or the binary is not on PATH. */
  cli: { name: string; version: string | null } | null;
  /** Is the launch command resolvable? An absent harness has no version to read
   *  and nothing to update, so a row must not offer an action for it. */
  installed: boolean;
  /** The version the agent reported, or null when it has never answered. */
  current: string | null;
  /** The version its install source offers, for an `npm` harness. */
  latest: string | null;
  updateAvailable: boolean;
  /** Why a field is empty, in words — never a bare dash. */
  note: string | null;
  /** The command that updates it, for `self` and `own`. */
  command: string | null;
}

/** How long a registry answer is reused when the caller did not force a read. */
const LATEST_TTL_MS = 10 * 60_000;

declare global {
  // eslint-disable-next-line no-var
  var __kabmoHarnessLatest: Map<string, { version: string | null; at: number }> | undefined;
}

function latestCache(): Map<string, { version: string | null; at: number }> {
  globalThis.__kabmoHarnessLatest ??= new Map();
  return globalThis.__kabmoHarnessLatest;
}

/**
 * Is this harness's launch command resolvable?
 *
 * The same rule the catalog uses (`commandAvailable` in `harness/root.ts`), kept
 * here as well because THIS route answers "what can be updated" and a harness
 * that is not installed answers "nothing". Offering an Update for an absent
 * agent was measured: an install that never happened cannot be updated, and the
 * button only produced a `not found` from npm.
 */
function launchable(id: HarnessId): boolean {
  if (id === 'omp-acp') return Boolean(resolveOmpBin());
  const launch = HARNESS_LAUNCH[id];
  const [binary] = launch?.command ?? [];
  if (!binary) return false;
  if (binary === 'npx') return Boolean(Bun.which('npx') ?? Bun.which('node'));
  return Boolean(Bun.which(binary));
}

/** How long a CLI version read is reused. A binary does not change under us. */
const CLI_VERSION_TTL_MS = 10 * 60_000;

declare global {
  // eslint-disable-next-line no-var
  var __kabmoHarnessCliVersions: Map<string, { version: string | null; at: number }> | undefined;
}

function cliVersions(): Map<string, { version: string | null; at: number }> {
  globalThis.__kabmoHarnessCliVersions ??= new Map();
  return globalThis.__kabmoHarnessCliVersions;
}

/**
 * The installed CLI's own version, from `--version`.
 *
 * The number a user recognises. `claude --version` prints `2.1.318 (Claude Code)`
 * while the ACP adapter reports `0.101.0` — two real numbers for two real things,
 * and showing only the adapter read as "why is my 2.x showing 0.100?".
 *
 * Best-effort: a missing binary or a timeout is `null`, never an error, because
 * the row still has the adapter's version to show.
 */
async function cliVersion(bin: string): Promise<string | null> {
  const cache = cliVersions();
  const cached = cache.get(bin);
  if (cached && Date.now() - cached.at < CLI_VERSION_TTL_MS) return cached.version;
  let version: string | null = null;
  try {
    if (Bun.which(bin)) {
      const proc = Bun.spawn({ cmd: [bin, '--version'], stdout: 'pipe', stderr: 'pipe', timeout: 5000 });
      const text = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
      await proc.exited;
      // The first version-shaped token: `2.1.318 (Claude Code)`, `codex-cli 0.166.0`.
      version = text.match(/\b(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\b/)?.[1] ?? null;
    }
  } catch {
    version = null;
  }
  cache.set(bin, { version, at: Date.now() });
  return version;
}

/** Every harness's row, in catalog order. */
export async function harnessVersionRows(force = false): Promise<HarnessVersionRow[]> {
  const probes = await loadProbes();
  const cache = latestCache();

  const rows = await Promise.all(HARNESS_IDS.map(async (id) => {
    const descriptor = harnessDescriptor(id);
    const facts = harnessUpdateFacts(id);
    const agentVersion = probes.get(id)?.capabilities.agentVersion ?? null;
    // An ABSENT harness gets no registry read and no action: there is no install
    // to update, and the npm number would describe a package this machine does
    // not have.
    const installed = id === 'omp-rpc' ? true : launchable(id);
    // What a user calls "the version": their CLI. The adapter's number is kept
    // beside it rather than replacing it.
    const cli = facts?.cli
      ? { name: facts.cli.name, version: installed ? await cliVersion(facts.cli.bin) : null }
      : null;
    const current = agentVersion;
    const pkg = installed ? latestSourceFor(id) : null;

    let latest: string | null = null;
    if (pkg) {
      const cached = cache.get(pkg);
      if (!force && cached && Date.now() - cached.at < LATEST_TTL_MS) {
        latest = cached.version;
      } else {
        latest = await fetchNpmLatest(pkg);
        cache.set(pkg, { version: latest, at: Date.now() });
      }
    }

    // `—` is a real answer. A comparison needs BOTH numbers, and claiming
    // "up to date" about a harness with no probe would be a fabricated fact.
    const comparable = Boolean(current && latest);
    const updateAvailable = comparable && isNewer(latest as string, current as string);

    let note: string | null = facts?.note ?? null;
    if (!installed) note = 'Not installed on this machine — nothing to update.';
    else if (!facts) note = 'Kabmo knows nothing about updating this harness.';
    else if (!current) note = 'Not probed yet — check its status to learn the version it runs.';
    else if (facts.kind !== 'npm') note = facts.command ? `Updated by \`${facts.command}\`.` : note;
    else if (!latest) note = `Could not read ${pkg} from the registry.`;

    return {
      id,
      label: descriptor?.label ?? id,
      kind: installed ? facts?.kind ?? null : null,
      installed,
      agentVersion,
      cli,
      current,
      latest,
      updateAvailable: installed && updateAvailable,
      note,
      // An absent harness has no command to offer: the reader would copy a line
      // that cannot run until the agent exists.
      command: installed ? facts?.command ?? null : null,
    };
  }));

  // The built-in transport has no agent, no version and nothing to update; it is
  // listed LAST rather than dropped, because a reader counts the harnesses.
  return rows;
}

/** GET /api/harness/versions?force=1 */
export async function loader({ request }: LoaderFunctionArgs) {
  const force = new URL(request.url).searchParams.get('force') === '1';
  return json({ harnesses: await harnessVersionRows(force) }, { headers: NO_STORE_HEADERS });
}
