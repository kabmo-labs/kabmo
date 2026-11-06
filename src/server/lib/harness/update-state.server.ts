/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The INSTALLED and LATEST version of each PART of a harness — the one read both
 * "what am I running?" (the versions route) and "what would an update move?" (the
 * update route) are built on.
 *
 * A harness is not always one package. `claude` is an ACP ADAPTER
 * (`@agentclientprotocol/claude-agent-acp`, the number the probe reports) sitting
 * on top of a CLI (`claude --version`, its own npm package, its own `claude
 * update`). The two move independently — measured on this machine, the adapter was
 * 0.100.0 while the CLI was 2.1.318 — so each part is read, compared and reported
 * on its own line, and an update moves only the part that is behind.
 *
 * Both reads are cached process-wide because both are expensive and change
 * slowly: `--version` spawns the binary, a registry read is a network request.
 * `force` bypasses the REGISTRY cache only — that is the "Check again" path. A
 * binary does not change under us, except through an update, which calls
 * `forgetCliVersion` and `forgetProbe` so the next read states what is on disk.
 */

import { resolveOmpBin } from '@/server/lib/omp/core/cli';
import { fetchNpmLatest } from '@/server/lib/updates/npm';
import { HARNESS_LAUNCH } from '@/server/lib/harness/launch';
import type { HarnessId } from '@/shared/lib/harness/catalog';
import { harnessUpdateFacts, latestSourceFor } from '@/shared/lib/harness/updates';

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
 * The newest version npm serves for `pkg`, cached for `LATEST_TTL_MS`.
 *
 * A null answer is cached too: a registry that could not be read must not be
 * asked again on every row of the same dialog.
 */
export async function latestVersion(pkg: string, force = false): Promise<string | null> {
  const cache = latestCache();
  const cached = cache.get(pkg);
  if (!force && cached && Date.now() - cached.at < LATEST_TTL_MS) return cached.version;
  const version = await fetchNpmLatest(pkg);
  cache.set(pkg, { version, at: Date.now() });
  return version;
}

/**
 * Is this harness's launch command resolvable?
 *
 * The same rule the catalog uses (`commandAvailable` in `harness/root.ts`), kept
 * here as well because THIS module answers "what can be updated" and a harness
 * that is not installed answers "nothing". Offering an Update for an absent
 * agent was measured: an install that never happened cannot be updated, and the
 * button only produced a `not found` from npm.
 */
export function harnessLaunchable(id: HarnessId): boolean {
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
export async function cliVersion(bin: string): Promise<string | null> {
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

/**
 * Forget a cached CLI read: the binary on disk just changed.
 *
 * Without it the row keeps reporting the version it read BEFORE an update for the
 * rest of the TTL — the same defect `forgetProbe` fixes for the adapter.
 */
export function forgetCliVersion(bin: string): void {
  cliVersions().delete(bin);
}

/** One part's installed and registry version. */
export interface HarnessPartVersions {
  /** What is on disk, or null when it has never answered. */
  version: string | null;
  /** What its install source offers, or null when it has no source Kabmo reads. */
  latest: string | null;
}

/** The CLI underneath an adapter, with the name a reader recognises. */
export interface HarnessCliVersions extends HarnessPartVersions {
  name: string;
  bin: string;
}

export interface HarnessVersionState {
  /** Is the launch command resolvable? An absent harness has nothing to move. */
  installed: boolean;
  /** The ADAPTER — the number the probe reported — and its own package. */
  agent: HarnessPartVersions;
  /** The CLI underneath, when this harness is an adapter for one. */
  cli: HarnessCliVersions | null;
}

/**
 * Every part's installed and latest version, in one read.
 *
 * `agentVersion` is passed in rather than read here so a caller listing the whole
 * catalog pays for ONE `loadProbes()`; this function is about versions, not about
 * which probes exist.
 */
export async function harnessVersionState(
  id: HarnessId,
  agentVersion: string | null,
  force = false,
): Promise<HarnessVersionState> {
  const facts = harnessUpdateFacts(id);
  const installed = id === 'omp-rpc' ? true : harnessLaunchable(id);

  // An ABSENT harness gets no registry read: there is no install to update, and
  // the npm number would describe a package this machine does not have.
  const agentPkg = installed ? latestSourceFor(id) : null;
  const agentLatest = agentPkg ? await latestVersion(agentPkg, force) : null;

  let cli: HarnessCliVersions | null = null;
  if (facts?.cli) {
    const version = installed ? await cliVersion(facts.cli.bin) : null;
    // The CLI's own package is only asked about when the harness names BOTH its
    // package and its updater: a newer registry number Kabmo cannot install is a
    // promise the row could not keep, and `claude`'s updater is what keeps a
    // package-manager install consistent with itself.
    const movable = Boolean(facts.command && facts.cli.pkg);
    const cliLatest = version && movable ? await latestVersion(facts.cli.pkg as string, force) : null;
    cli = { name: facts.cli.name, bin: facts.cli.bin, version, latest: cliLatest };
  }

  return {
    installed,
    agent: { version: agentVersion, latest: agentLatest },
    cli,
  };
}
