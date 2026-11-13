/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Running a harness probe, and the boot pass that refreshes every ON harness.
 *
 * Three callers need the config-aware probe: the settings route's Check status,
 * switching a harness on, and this module's startup pass. It cannot live in a
 * route (`routes/harness/root.ts` used to own it) because the boot clock is not
 * a request and a route must not be the import of the startup path.
 *
 * **The startup pass is per PROCESS, not per module evaluation.** A `bun --hot`
 * reload re-runs the server entry, and a probe spawns an agent process; without
 * the `globalThis` pid guard every edit during development would start one agent
 * per enabled harness. A real restart is a new pid and therefore a fresh pass,
 * which is the moment the requirement names: every Kabmo restart re-checks the
 * harnesses the user keeps ON.
 *
 * It runs in the BACKGROUND. A probe can take a minute (an agent that has to
 * authenticate, a wrapper that resolves a container), and the listener is
 * already accepting requests — boot must not wait for twelve agents to answer.
 *
 * Which harnesses are checked:
 *
 *  - switched OFF (`omp_harness_disabled`) is skipped — the roster is the user's
 *    answer, and probing an agent they hid would start a process for a tab they
 *    never see;
 *  - the built-in `omp-rpc` transport is skipped: there is no agent to spawn;
 *  - a harness whose launch command is not resolvable is skipped for the same
 *    measured reason as the toggle route: the card already says "not installed",
 *    and spawning a missing binary only reports that fact again.
 */

import type { HarnessProbe } from '@/server/lib/harness/capabilities';
import {
  launchFromConfig,
  loadHarnessConfig,
  resolveLaunch,
} from '@/server/lib/harness/config.server';
import type { HarnessConfig } from '@/shared/lib/harness/config';
import { loadDisabledHarnesses } from '@/server/lib/harness/enabled.server';
import { blockedProbe, probeHarness } from '@/server/lib/harness/launch';
import { HARNESS_LAUNCH, harnessRequirementMet, type HarnessLaunch } from '@/server/lib/harness/launch-table';
import { customLaunch } from '@/server/lib/harness/custom.server';
import { resolveOmpBin } from '@/server/lib/omp/core/cli';
import { whichOnToolchainPath } from '@/server/lib/fs/toolchain-path';
import { rememberProbe } from '@/server/lib/harness/probe-cache.server';
import { harnessDescriptor, harnessIds, type HarnessId } from '@/shared/lib/harness/catalog';
import { harnessEnabled } from '@/shared/lib/harness/enabled';

declare global {
  // eslint-disable-next-line no-var
  var __kabmoHarnessAutoProbePid: number | undefined;
}

/**
 * Is a launch command first-token resolvable? The omp binary has its own
 * resolver (KABMO_OMP_BIN, then PATH) and is never "missing" through PATH alone.
 *
 * The USER's command override decides this, not the build's table: a harness
 * whose binary lives behind a wrapper, a container (`docker run … agy acp`) or an
 * absolute path read as "not installed" and could not even be switched on, while
 * a spawn of that same configured command worked.
 */
export function commandAvailable(id: HarnessId, config?: HarnessConfig): boolean {
  if (id === 'omp-acp') return Boolean(resolveOmpBin());
  let launch: HarnessLaunch | undefined = HARNESS_LAUNCH[id] ?? customLaunch(id);
  if (config) {
    try {
      const configured = launchFromConfig(id, config);
      if (configured) launch = configured;
    } catch {
      // An unusable env line is reported by the probe; availability falls back
      // to the build's table rather than claiming "not installed".
    }
  }
  const [binary] = launch?.command ?? [];
  if (!binary) return false;
  // An adapter can need a binary it SPAWNS rather than execs: the zcode bridge
  // starts `zcode app-server --stdio`, so `npx` being present says nothing.
  if (!harnessRequirementMet(launch?.requires, launch?.env)) return false;
  if (binary === 'npx') return Boolean(whichOnToolchainPath('npx') ?? whichOnToolchainPath('node'));
  return Boolean(whichOnToolchainPath(binary));
}

/**
 * Probe a harness the way a SPAWN would launch it: the user's command and env
 * override are part of what is being measured.
 *
 * Without this, a harness that only works with its configured env — `CODEX_HOME`,
 * a provider base URL, a wrapper that logs in — probed as "Authentication
 * required" in Settings while its chats ran fine. A launch line that cannot even
 * be resolved (an invalid env line) answers a `blocked` record instead of a 500.
 */
export async function probeWithConfig(id: HarnessId, cwd: string): Promise<HarnessProbe> {
  try {
    const configured = await loadHarnessConfig(id);
    return await probeHarness(id, cwd, resolveLaunch(id, configured));
  } catch (cause) {
    return blockedProbe(id, cause instanceof Error ? cause.message : String(cause));
  }
}

/** Seams for the tests: the real catalog, availability and probe by default. */
export interface AutoProbeOptions {
  cwd?: string;
  ids?: readonly HarnessId[];
  available?: (id: HarnessId, config: HarnessConfig) => boolean;
  probe?: (id: HarnessId, cwd: string) => Promise<HarnessProbe>;
}

/** The harnesses the user keeps ON that this machine can actually launch. */
export async function autoProbeTargets(
  options: Pick<AutoProbeOptions, 'ids' | 'available'> = {},
): Promise<HarnessId[]> {
  const ids = options.ids ?? harnessIds();
  const available = options.available ?? commandAvailable;
  const disabled = await loadDisabledHarnesses();
  const targets: HarnessId[] = [];
  for (const id of ids) {
    if (harnessDescriptor(id)?.builtIn) continue;
    if (!harnessEnabled(id, disabled)) continue;
    const config = await loadHarnessConfig(id);
    if (!available(id, config)) continue;
    targets.push(id);
  }
  return targets;
}

/** What one boot pass did, for the log line and for the tests. */
export interface AutoProbeOutcome {
  probed: HarnessId[];
  failed: Array<{ id: HarnessId; error: string }>;
}

/**
 * Probe every target, one at a time, and write each answer to the cache.
 *
 * Sequential on purpose: these are agent processes, and a boot that starts one
 * per installed harness at once competes with the chat the user just opened. A
 * failure on one harness is recorded and the pass continues — the others still
 * deserve their answer.
 */
export async function runAutoProbe(options: AutoProbeOptions = {}): Promise<AutoProbeOutcome> {
  const cwd = options.cwd ?? process.cwd();
  const probe = options.probe ?? probeWithConfig;
  const targets = await autoProbeTargets(options);
  const outcome: AutoProbeOutcome = { probed: [], failed: [] };
  for (const id of targets) {
    try {
      await rememberProbe(id, await probe(id, cwd));
      outcome.probed.push(id);
    } catch (error) {
      outcome.failed.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return outcome;
}

/**
 * Start the boot pass. Idempotent within one process — a `bun --hot` reload must
 * not spawn the agents again — and never awaited, because boot does not wait for
 * an agent to answer.
 */
export function startHarnessAutoProbe(): void {
  if (globalThis.__kabmoHarnessAutoProbePid === process.pid) return;
  globalThis.__kabmoHarnessAutoProbePid = process.pid;
  void runAutoProbe()
    .then(({ probed, failed }) => {
      if (probed.length > 0) console.log(`[harness] probed on boot: ${probed.join(', ')}`);
      for (const failure of failed) {
        console.error(`[harness] ${failure.id}: boot probe failed — ${failure.error}`);
      }
    })
    .catch((error) => {
      console.error('[harness] boot probe skipped:', error);
    });
}
