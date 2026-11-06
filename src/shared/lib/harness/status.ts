/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a harness's status actually IS, as data.
 *
 * The settings card used to render one word — `blocked` — for four unrelated
 * conditions: a binary that is not on PATH, an agent that is installed but
 * refuses to start until you log in, a probe that has never run, and a transport
 * Kabmo ships itself. The reader learned nothing and the fix differed in every
 * case: install a package, run a login command, press a button, or do nothing.
 *
 * So the state is derived once, here, from facts the card already has:
 *
 *  - `builtIn` — no agent to install or probe (omp over RPC);
 *  - `canLaunch` false — the launch command's binary is not resolvable;
 *  - a probe the AGENT refused (`capabilities.blocked`) — auth, licence, a
 *    broken plugin;
 *  - a probe that answered — ready, with the version it reported;
 *  - nothing — never probed, which is an absence of information, not a problem.
 *
 * The order is the precedence: a missing binary outranks a stale refusal (there
 * is nothing to authenticate against with no binary on disk), and a refusal
 * outranks "not probed" (something did answer).
 */

import type { HarnessSummary } from '@/shared/types/harness';

export type HarnessState =
  /** Installed and answering. */
  | 'ready'
  /** The launch command's first token is not on PATH. */
  | 'not-installed'
  /** Installed, but the agent refuses until the user does something (auth, …). */
  | 'needs-setup'
  /** Never probed: unknown, not wrong. */
  | 'unprobed';

export interface HarnessStatus {
  state: HarnessState;
  /** The chip's words — short enough for a header row. */
  label: string;
  /** The concrete sentence: what is missing, stated with the binary's own name.
   *  Null only for `ready`, where the version (or nothing) is the whole story. */
  detail: string | null;
}

/** The first token of a launch command, for naming what is missing. */
function missingBinary(unavailable: string | undefined, id: string): string {
  if (!unavailable) return id;
  const match = /`([^`]+)`/.exec(unavailable);
  return match?.[1] ?? id;
}

/** Derive the status a card should show. */
export function harnessStatus(summary: HarnessSummary): HarnessStatus {
  if (summary.builtIn) {
    return {
      state: 'ready',
      label: 'built in',
      detail: 'Kabmo runs this transport itself — nothing to install or probe.',
    };
  }

  if (!summary.canLaunch) {
    const binary = missingBinary(summary.unavailable, summary.id);
    return {
      state: 'not-installed',
      label: 'not installed',
      // The binary's OWN name, not the harness id: `minimax` is launched by
      // `mcode` and `cursor` by `cursor-agent`, so "minimax is not installed"
      // would send the reader looking for a package that does not exist.
      detail: `${summary.label}: \`${binary}\` was not found on PATH, so it cannot be launched.`,
    };
  }

  const blocked = summary.probe?.capabilities.blocked;
  if (blocked) {
    return { state: 'needs-setup', label: 'needs setup', detail: `${summary.label}: ${blocked}` };
  }

  if (summary.probe) {
    const agentVersion = summary.probe.capabilities.agentVersion;
    const version = agentVersion ? `answered as version ${agentVersion}` : 'answered';
    // An AGED record is still the last real answer, so the state stays `ready`
    // (or `needs setup`, above) — but the sentence says WHEN, because a version
    // reported an hour ago describes the binary as it was an hour ago and the
    // user needs to know that before trusting an update decision.
    if (summary.probe.stale) {
      const minutes = Math.max(1, Math.round((Date.now() - summary.probe.probedAt) / 60_000));
      const age = minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
      return {
        state: 'ready',
        label: 'ready (aged)',
        detail: `${summary.label} ${version} ${age} ago. Press Check status to read the version on disk now.`,
      };
    }
    return {
      state: 'ready',
      label: 'ready',
      detail: version ? `${summary.label} answered as version ${agentVersion}.` : null,
    };
  }

  return {
    state: 'unprobed',
    label: 'not probed',
    detail: `${summary.label} has not answered yet — press Check status to ask it for its models and session features.`,
  };
}
