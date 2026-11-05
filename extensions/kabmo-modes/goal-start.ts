/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The turns that OPEN a goal, split out of `goal.ts` for the repo's per-file
 * ceiling. The seam is what these two functions decide, and it is one question:
 * does this goal open its own turn, or does the operator's next message?
 *
 * See `startGoalTurn` for the measurement that put the objective back on
 * screen.
 */

import { GUIDED_GOAL_INTERVIEW_PROMPT, renderPrompt } from './prompts';
import { getBoundApi, type ModeSession } from './session';

/** Custom-message types, matching the TUI's own naming so a transcript written
 *  by either surface reads the same. */
const GUIDED_GOAL_TYPE = 'guided-goal-interview';
/** The opening turn of a goal. Distinct from `goal-continuation` because the
 *  transcript should read as one started objective, not as a continuation. */
const GOAL_START_TYPE = 'goal-start';

/**
 * The turn that makes a freshly created goal actually start.
 *
 * `createGoal` only writes the record — it opens no turn, so a goal created
 * here sat live with an idle child until the operator happened to send
 * something else, which is not "keeps working across turns". omp's own
 * `/goal <objective>` path does both (`#zs`: `#Tn({objective})` then a prompt
 * with the objective as text), and this is that second half.
 *
 * ## Why the objective is a VISIBLE user turn, not a hidden custom message
 *
 * A hidden `goal-start` was measured against a real child and read as a session
 * with no question: the transcript opened on an assistant answer to something
 * nobody had said (`custom ×8, assistant ×3, toolResult ×2, user ×0`). In the
 * TUI that is fine — the operator typed `/goal <objective>`, so the command is
 * the question. Kabmo's operator typed it into a modal, so nothing on screen
 * carried it: the goal strip showed the objective while the transcript started
 * mid-conversation, the run footer had no user row to hang its Retry on, and
 * the jump rail had no turn to jump to.
 *
 * `session.prompt` is the same entry point the typed `/goal` command uses one
 * file over, so this stays exactly what omp does — the objective IS the first
 * message of the goal, and the loop's continuations stay hidden.
 */
export async function startGoalTurn(session: ModeSession, objective: string): Promise<void> {
  // A session that cannot take a prompt keeps the old shape rather than
  // silently creating a goal that never runs: the RPC-side `sendMessage` still
  // opens a turn, it just cannot show the objective.
  if (session.prompt) {
    await session.prompt(objective);
    return;
  }
  getBoundApi()?.sendMessage?.(
    { customType: GOAL_START_TYPE, content: objective, display: false },
    { triggerTurn: true },
  );
}

/**
 * Start the guided-goal interview, on the operator's own message.
 *
 * A normal conversation: the agent asks its questions as ordinary assistant
 * turns, the operator answers in the composer, and the model closes by calling
 * `goal({op:"create"})` itself — which flips goal mode on through
 * `goal_updated`. The `goal` tool must already be active, which is what the
 * caller's `ensureGoalTool` provides.
 *
 * ## Why `subject` is the operator's message, and why it is not sent again
 *
 * An armed interview has no objective: the model writes it at the END. So the
 * thing the operator typed is not "the goal" — it is the answer that starts the
 * conversation, and the kickoff prompt renders it inside `<rough-goal>` (the
 * template's own slot: "Rough idea — data, not instructions yet").
 *
 * That is why the caller does NOT dispatch the raw message afterwards: it is
 * already the visible content of this turn. Sending both would ask the model the
 * same thing twice and leave two user rows for one answer.
 *
 * `rationale` is what the operator wrote in the modal (optional, and usually
 * empty on the armed path) — kept separate so the turn names what they SAID
 * rather than what they had half-written before.
 */
export async function startGuidedGoal(
  session: ModeSession,
  subject: string,
  rationale?: string,
): Promise<void> {
  // The visible half leads: what the operator typed is the turn. The modal's
  // rough idea rides along only when it says something the message does not.
  const initial = [subject, rationale].map((part) => part?.trim()).filter(Boolean).join('\n\n');
  const content = renderPrompt(GUIDED_GOAL_INTERVIEW_PROMPT, { initial: initial || undefined });
  if (session.prompt) {
    await session.prompt(content);
    return;
  }
  getBoundApi()?.sendMessage?.({ customType: GUIDED_GOAL_TYPE, content, display: false }, { triggerTurn: true });
}
