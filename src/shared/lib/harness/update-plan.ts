/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which parts of a harness an update must move — decided from the numbers, not
 * from a guess.
 *
 * **A harness can be two installs.** `claude` is an npm ADAPTER
 * (`@agentclientprotocol/claude-agent-acp`, the version the probe reports) sitting
 * on top of the `claude` CLI (its own `--version`, its own `claude update`), and
 * they move independently — measured on a real install: adapter 0.100.0 under CLI
 * 2.1.318.
 *
 * The rule that matters: **a part is moved only when it is BEHIND.** Pushing both
 * unconditionally reinstalled an adapter that was already current while the report
 * claimed it had "updated to 0.101.0". And a part whose latest version Kabmo cannot
 * read (a `self` CLI, a CLI with no package in the facts) is never planned: Kabmo
 * cannot claim it is behind.
 *
 * Pure, so the decision is testable without spawning anything — the route only
 * runs the argv this returns.
 */

import { isNewer } from '@/shared/lib/updates/semver';
import type { HarnessUpdateFacts } from '@/shared/lib/harness/updates';

/** One part's installed and latest version. */
export interface UpdatePartVersions {
  version: string | null;
  latest: string | null;
}

/** What the version read knows about a harness. */
export interface UpdatePlanState {
  /** Is the harness on this machine? An absent one has nothing to move. */
  installed: boolean;
  /** The ADAPTER — the version the probe reported — and its own package. */
  agent: UpdatePartVersions;
  /** The CLI underneath, when this harness is an adapter for one. */
  cli: (UpdatePartVersions & { name: string }) | null;
}

/** One part of an update: what to run, and how the report names it. */
export interface HarnessUpdateStep {
  /** `adapter`, `Claude Code`, or the harness label — never a bare package name. */
  part: string;
  /** The command line a reader could repeat. */
  command: string;
  /** The argv actually spawned. */
  argv: string[];
}

/**
 * The steps that would move this harness.
 *
 * No probe (`agentVersion === null`) means no number to compare, so the adapter
 * step is still planned: a press on an unprobed row means "make this install
 * current" rather than "it is already current", and the route's answer says that
 * no comparison happened.
 */
export function planHarnessUpdate(
  label: string,
  facts: HarnessUpdateFacts | null,
  state: UpdatePlanState,
  agentVersion: string | null,
): HarnessUpdateStep[] {
  if (!state.installed || !facts) return [];
  const steps: HarnessUpdateStep[] = [];

  if (facts.kind === 'npm' && facts.pkg && state.agent.latest) {
    const latest = state.agent.latest;
    const behind = agentVersion === null || isNewer(latest, agentVersion);
    if (behind) {
      steps.push({
        // An adapter over a CLI is named `adapter`, so a report cannot be read as
        // "the CLI moved" when only its bridge did.
        part: state.cli ? 'adapter' : label,
        command: `npm install -g ${facts.pkg}@${latest}`,
        argv: ['npm', 'install', '-g', `${facts.pkg}@${latest}`],
      });
    }
  }

  // The CLI moves through ITS OWN updater (`claude update`), invoked by name: the
  // adapter pins the CLI version it bridges, so this is the half that used to be
  // left stale — and it is also the ONLY half that moves when the adapter is
  // already current.
  const { cli } = state;
  if (cli && facts.command && cli.latest && cli.version && isNewer(cli.latest, cli.version)) {
    steps.push({
      part: cli.name,
      command: facts.command,
      argv: facts.command.split(' '),
    });
  }

  return steps;
}
