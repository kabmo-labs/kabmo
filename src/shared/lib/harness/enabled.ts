/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which harnesses this install keeps ON.
 *
 * The catalog is what Kabmo KNOWS how to launch; this is what the user wants in
 * their way. Two different questions, and conflating them is why the settings
 * page used to list twelve agents whether or not any of them could run: a person
 * driving `omp` alone had to read past nine adapters they will never install.
 *
 * **Stored as the DISABLED list, not the enabled one.** A catalog entry added by
 * a Kabmo update must arrive ON — the user asked to hide specific agents, not to
 * freeze the roster they happened to see on the day they first opened Settings.
 * An empty (or absent) list therefore means "everything", and a stale id left in
 * it by a retired harness is simply ignored.
 *
 * The BUILT-IN transport has no switch: `omp` over RPC is the path this app is,
 * there is nothing to install, and a build with it off could run no chat at all.
 */

import { harnessDescriptor, type HarnessId } from '@/shared/lib/harness/catalog';

/** The `app_settings` key holding the disabled harness ids. */
export const HARNESS_DISABLED_KEY = 'omp_harness_disabled';

/** Can this harness be switched at all? False only for the built-in transport. */
export function harnessSwitchable(id: string): boolean {
  return !harnessDescriptor(id)?.builtIn;
}

/**
 * Read the stored list into the ids this build still knows.
 *
 * Untrusted input — a hand-edited row, an older build's shape, a plugin write —
 * so anything that is not a string is dropped and duplicates collapse.
 */
export function parseDisabledHarnesses(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || !entry || seen.has(entry)) continue;
    // A retired harness id would otherwise sit in the list forever, counting as
    // "disabled" for a row nothing draws.
    if (!harnessDescriptor(entry)) continue;
    if (!harnessSwitchable(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

/** Is this harness on, given the disabled list? */
export function harnessEnabled(id: string, disabled: readonly string[]): boolean {
  if (!harnessSwitchable(id)) return true;
  return !disabled.includes(id);
}

/** The list after switching one harness, or the same list when it cannot be
 *  switched. Pure, so the rule is testable without a database. */
export function withHarnessEnabled(
  id: HarnessId | string,
  enabled: boolean,
  disabled: readonly string[],
): string[] {
  if (!harnessSwitchable(id)) return [...disabled];
  const rest = disabled.filter((entry) => entry !== id);
  return enabled ? rest : [...rest, id];
}
