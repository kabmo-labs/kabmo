/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The vocabulary the composer and the goal surfaces share: the actions the
 * Goal modal can submit, and the ARMED form one of them becomes.
 *
 * Its own module because three layers need the same names — the mode hook
 * (`modes.ts`) produces them, `goal-command.ts` executes them, and the
 * components name them in props (`ArmedGoalStrip`, `ModeToggles`,
 * `GoalModal`). Re-declaring the union in a component would let a new action
 * compile in one place and fail silently in another.
 */

/** A goal recorded but not started: what the next prompt turns into.
 *
 *  Setting a goal does not run anything — the record is created at the fence of
 *  the next prompt (`startTurn: false`), so that prompt is the goal's first
 *  turn. See `modes.ts` for why.
 *
 *  Two shapes, and they differ in what the operator's first message MEANS:
 *
 *  - `create` — the message is the goal's work; `objective` is already written.
 *  - `guided` — the message is the ANSWER that starts the interview. There is no
 *    objective yet (the model writes it at the end of the interview), so the
 *    message is folded into the kickoff prompt as the rough idea. */
export type ArmedGoal =
  | { kind: 'create'; objective: string; tokenBudget?: number; maxTurns?: number }
  | { kind: 'guided'; rough: string };

/** One command from the Goal modal or the goal strip. */
export type GoalAction =
  | { kind: 'create'; objective: string; tokenBudget?: number; maxTurns?: number }
  | { kind: 'guided'; rough: string }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'drop' }
  | { kind: 'budget'; value: number | 'off' };
