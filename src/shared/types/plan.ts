/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Plan-mode artifacts of one session, as the right-panel Plan view reads them.
 *
 * A plan is omp's file, not a Kabmo record: the reader lists the session's
 * `local/` artifact directory and serves the chosen plan's body verbatim. The
 * types carry no state of their own — `current` is what the session's plan mode
 * names (or the newest file), and `files` is everything available to switch to.
 */

/** One plan artifact on disk. */
export interface SessionPlanFile {
  /** `local://<slug>-plan.md` — the identity the reader round-trips. */
  path: string;
  /** The slug, without the `-plan.md` suffix. */
  title: string;
  /** Epoch ms of the last write, for ordering and the "updated" line. */
  modifiedAt: number;
  bytes: number;
}

export interface SessionPlanState {
  /** Every plan artifact in the session, newest first. */
  files: SessionPlanFile[];
  /** The plan the session is on: what plan mode names, else the newest. */
  current: string | null;
  /** The chosen plan's markdown, or null when there is nothing to read. */
  content: string | null;
  /** True when the plan was cut at the reader's byte budget. */
  truncated: boolean;
}

/** Wire payload of the session's `plan` realtime topic. */
export interface SessionPlanPayload extends SessionPlanState {
  sessionId: string;
  generatedAt: string;
  isMock: boolean;
}
