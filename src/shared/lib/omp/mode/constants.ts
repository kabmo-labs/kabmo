/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The wire vocabulary the mode extension and Kabmo share.
 *
 * Every name here has TWO spellings, and the split is the contract:
 *
 * - `KABMO_*` / `kabmo-*` is what this build WRITES: the custom-entry types it
 *   appends, the environment variable it exports into a child, the slash
 *   command it registers and the notice markers it emits.
 * - `CHAMBER_*` / `chamber-*` is what a session written before the rename
 *   CARRIES, and it is still READ. A resumed session's JSONL holds the old
 *   entry types and the old markers, and the extension file on disk may still
 *   be the old one until it is regenerated — refusing the old spelling would
 *   make every pre-rename session lose its plan and goal state on resume.
 *
 * The write side is a single spelling so the two can never disagree about what
 * is current; the read side accepts both. `mode-protocol.test.ts` pins the
 * pairs, and a mismatch between the extension and this module is a runtime
 * failure with no compile-time signal, which is why the table is asserted
 * rather than described.
 */

/** The current spelling of every shared name. */
export const MODE_PROTOCOL = {
  goalStateEntry: 'kabmo-goal-state',
  planStateEntry: 'kabmo-plan-state',
  modesEnv: 'KABMO_MODES',
  modeCommand: 'kabmo-mode',
  planStateMarker: 'KABMO_PLAN_STATE:',
  goalStateMarker: 'KABMO_GOAL_STATE:',
  modeStateMarker: 'KABMO_MODE_STATE:',
  modeErrorMarker: 'KABMO_MODE_ERROR:',
  planProposalMarker: 'KABMO_PLAN_PROPOSAL:',
  planDecisionMarker: 'KABMO_PLAN_DECISION:',
  planSavedMarker: 'KABMO_PLAN_SAVED:',
  goalContinuationMarker: 'KABMO_GOAL_CONTINUATION:',
  goalEvaluatingMarker: 'KABMO_GOAL_EVALUATING:',
} as const;

/**
 * The pre-rename spelling of each name, read as a fallback.
 *
 * @deprecated Nothing writes these. They exist so a session file, a spawn
 * environment or an extension bundle from before the rename keeps working.
 */
export const LEGACY_MODE_PROTOCOL = {
  goalStateEntry: 'chamber-goal-state',
  planStateEntry: 'chamber-plan-state',
  modesEnv: 'CHAMBER_MODES',
  modeCommand: 'chamber-mode',
  planStateMarker: 'CHAMBER_PLAN_STATE:',
  goalStateMarker: 'CHAMBER_GOAL_STATE:',
  modeStateMarker: 'CHAMBER_MODE_STATE:',
  modeErrorMarker: 'CHAMBER_MODE_ERROR:',
  planProposalMarker: 'CHAMBER_PLAN_PROPOSAL:',
  planDecisionMarker: 'CHAMBER_PLAN_DECISION:',
  planSavedMarker: 'CHAMBER_PLAN_SAVED:',
  goalContinuationMarker: 'CHAMBER_GOAL_CONTINUATION:',
  goalEvaluatingMarker: 'CHAMBER_GOAL_EVALUATING:',
} as const;

export type ModeProtocolName = keyof typeof MODE_PROTOCOL;

/** Every marker prefix, current and legacy, longest first. */
export const ALL_MODE_MARKERS: readonly string[] = [...Object.values(MODE_PROTOCOL), ...Object.values(LEGACY_MODE_PROTOCOL)]
  .filter((value) => value.endsWith(':'))
  .sort((a, b) => b.length - a.length);

/** Whether `value` is either spelling of `name` — the read-side predicate. */
export function matchesModeName(name: ModeProtocolName, value: string): boolean {
  return value === MODE_PROTOCOL[name] || value === LEGACY_MODE_PROTOCOL[name];
}

/**
 * Whether a parsed marker is `name`, under EITHER spelling.
 *
 * This is what a handler must compare with. The extension emits the `KABMO_*`
 * prefixes and a transcript replayed from before the rename carries the
 * `CHAMBER_*` ones, so a handler testing a literal string silently ignores half
 * of them — and the ignored half is whichever side the literal is not. The
 * failure is quiet: the marker still parses (it is not prose), it just moves
 * nothing, so a goal's record never reaches the strip and a plan review never
 * opens.
 */
export function isModeMarker(marker: string, name: ModeProtocolName): boolean {
  return matchesModeName(name, marker);
}
