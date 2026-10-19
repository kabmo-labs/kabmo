/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Plan- and Goal-mode actuation for Kabmo, running INSIDE the omp child.
 *
 * Why an extension: omp exposes neither mode over RPC. `RpcCommand` has no
 * plan/goal verb, `/plan` and `/goal` are `handleTui`-only (a prompt carrying
 * one reaches the model as literal text — measured), `mode_change` entries are
 * not restored under `--mode rpc-ui`, and `plan.defaultOnStartup` is read by
 * `interactive-mode.ts` alone. The extension API is the one surface that
 * reaches the live `AgentSession`, so Kabmo ships this file and the spawn
 * path passes it with `-e <abs path>`.
 *
 * Why `-e` and not `~/.omp/agent/extensions/`: Kabmo owns this file. An
 * install there would mutate the user's config, could be disabled from the
 * Settings → Extensions list, and would leave a stale copy behind on upgrade.
 * An explicit `-e` is also still honoured under `--no-extensions`.
 *
 * Control surface: one command, `/kabmo-mode <scope> <action> [json]`,
 * dispatched by Kabmo as an ordinary prompt. Measured: the command runs
 * locally, answers `agentInvoked: false`, and writes NO user message to the
 * transcript — so the mode controls never appear as conversation.
 *
 * Every outcome is reported through a notice MARKER (`KABMO_*_MARKER`), which
 * is how Kabmo learns the new state without polling: the frames reach it
 * over the same event stream the transcript uses.
 */

import {
  activeSession,
  bindApi,
  ensureGoalTool,
  enterPlanMode,
  modeCapabilities,
  recordPlanState,
  type ExtensionCtx,
  type ModeApi,
} from './session';
import { dispatchGoal, dispatchPlan, emit } from './commands';
import {
  CHAMBER_MODE_COMMAND,
  CHAMBER_MODES_ENV,
  KABMO_GOAL_STATE_ENTRY,
  KABMO_GOAL_STATE_MARKER,
  KABMO_MODE_COMMAND,
  KABMO_MODE_ERROR_MARKER,
  KABMO_PLAN_DECISION_MARKER,
  KABMO_PLAN_STATE_MARKER,
  KABMO_MODES_ENV,
  type GoalRecord,
} from './protocol';
import { goalStateRecord } from './goal';
import { installPlanProposal } from './plan';
import { peekParkedProposal, releaseForRefinement } from './parked';


function parseModesEnv(): { plan: boolean; goal: boolean } {
  // Both spellings: this build's spawn path exports `KABMO_MODES`, and a child
  // started by a pre-rename Kabmo (or by a hand-written environment) carries
  // `CHAMBER_MODES`. Reading only the new one would reopen that session with
  // both modes off and the composer's toggles lying.
  const raw = process.env?.[KABMO_MODES_ENV] ?? process.env?.[CHAMBER_MODES_ENV] ?? '';
  return { plan: raw.includes('plan'), goal: raw.includes('goal') };
}

/**
 * Re-apply Kabmo's persisted mode selection to a freshly spawned child.
 *
 * `--mode rpc-ui` never restores `mode_change`, so a session reopened from the
 * sidebar would otherwise come back with both modes off and the composer's
 * toggles lying. The flags ride in the spawn environment, which is the only
 * channel available before the child's first command.
 */
async function restoreModes(api: ModeApi, ctx: ExtensionCtx): Promise<void> {
  const wanted = parseModesEnv();
  if (!wanted.plan && !wanted.goal) return;
  const session = activeSession(api);
  if (!session) return;
  const caps = modeCapabilities(session);

  // Both flags can only arrive from a record written before the modes were
  // mutually exclusive. Plan wins: it is the passive one, while a restored goal
  // is what Kabmo's driver keeps opening turns for.
  const bothWanted = wanted.plan && wanted.goal;
  if (bothWanted) {
    emit(ctx, KABMO_MODE_ERROR_MARKER, {
      reason: 'This session recorded both plan mode and a goal; plan mode was restored and the goal was left off.',
    });
  }

  if (wanted.plan) {
    if (!caps.plan) emit(ctx, KABMO_MODE_ERROR_MARKER, { reason: 'plan-mode API missing in this omp build' });
    else {
      const planFilePath = session.getPlanReferencePath?.() || 'local://PLAN.md';
      await enterPlanMode(session, planFilePath);
      installPlanProposal(session, ctx);
      // The persisted record too, not just the live marker. `enterPlanMode`
      // writes omp's own `mode_change`, which `--mode rpc-ui` never restores,
      // and the spawn env is what re-applied the flag — so without this entry a
      // reloaded session's JSONL still said "plan off" while the child was in
      // plan mode, and the NEXT spawn read the stale record and came up with
      // plan mode off. Measured: plan on → toggle off before any turn → toggle
      // on again → the second spawn reported `plan: null`.
      recordPlanState(api, true);
      emit(ctx, KABMO_PLAN_STATE_MARKER, { enabled: true, planFilePath });
    }
  }
  if (wanted.goal && !bothWanted) {
    if (!caps.goal) emit(ctx, KABMO_MODE_ERROR_MARKER, { reason: 'goal-mode API missing in this omp build' });
    else {
      // The tool is enabled so the toggle can act immediately, but a restored
      // goal is deliberately NOT resumed: omp pauses an active goal on a cold
      // start precisely so it cannot resume unattended, and overriding that
      // would start spending tokens the moment someone opened the tab. The
      // state is reported as paused, and the composer's Resume is what restarts
      // it — the same decision omp made, surfaced instead of undone.
      await ensureGoalTool(api, session);
      emit(ctx, KABMO_GOAL_STATE_MARKER, goalStateRecord(session));
    }
  }
}

/** The extension entry: registers `/kabmo-mode`, omp's own command aliases,
 *  and the session/goal event handlers. */
export default function kabmoModes(api: ModeApi): void {
  bindApi(api);

  /**
   * One handler, registered under BOTH names.
   *
   * `kabmo-mode` is what this build's server sends. `chamber-mode` is the
   * pre-rename spelling, and it stays registered because the console that sends
   * it may still be the one an operator has open: a host that upgraded while a
   * tab was live keeps posting the old token until the page reloads, and an
   * unknown command there is a Plan/Goal toggle that does nothing.
   */
  const modeHandler = async (args: string, ctx: ExtensionCtx) => {
    const trimmed = args.trim();
    const [scopeToken = '', actionToken = '', ...tail] = trimmed.split(/\s+/);
    const scope = scopeToken.toLowerCase();
    const action = actionToken.toLowerCase();
    const rest = tail.join(' ');

    const session = activeSession(api);
    if (!session) {
      emit(ctx, KABMO_MODE_ERROR_MARKER, { reason: 'no live session found for this process' });
      return;
    }
    if (scope === 'plan') await dispatchPlan(api, session, ctx, action, rest);
    else if (scope === 'goal') await dispatchGoal(api, session, ctx, action, rest);
    else emit(ctx, KABMO_MODE_ERROR_MARKER, { reason: `unknown scope: ${scope || '(empty)'}` });
  };

  const modeDescription = 'Kabmo plan/goal mode control (driven by the web console, not typed by hand)';
  api.registerCommand?.(KABMO_MODE_COMMAND, { description: modeDescription, handler: modeHandler });
  api.registerCommand?.(CHAMBER_MODE_COMMAND, { description: modeDescription, handler: modeHandler });

  // The DOCS' own syntax, answered by the same code path.
  //
  // omp implements `/plan` and `/goal` with `handleTui` only, so a typed one
  // would otherwise reach the model as literal text. Now that Kabmo owns
  // these modes, a typed command is a real command: `/plan` toggles, `/goal`
  // opens the objective editor, and the subcommands the docs list are accepted.
  api.registerCommand?.('plan', {
    description: 'Toggle plan mode (agent plans before executing)',
    handler: async (args: string, ctx: ExtensionCtx) => {
      const session = activeSession(api);
      if (!session) {
        emit(ctx, KABMO_MODE_ERROR_MARKER, { reason: 'no live session found for this process' });
        return;
      }
      const objective = args.trim();
      if (session.getPlanModeState?.()?.enabled && !objective) {
        await dispatchPlan(api, session, ctx, 'off', '');
        return;
      }
      await dispatchPlan(api, session, ctx, 'on', '');
      // A prompt alongside `/plan` is the FIRST plan-mode turn, which is what
      // the docs describe; send it as an ordinary prompt now that the mode is on.
      if (objective) await session.prompt?.(objective);
    },
  });

  api.registerCommand?.('goal', {
    description: 'Toggle goal mode (persistent autonomous objective for this session)',
    handler: async (args: string, ctx: ExtensionCtx) => {
      const session = activeSession(api);
      if (!session) {
        emit(ctx, KABMO_MODE_ERROR_MARKER, { reason: 'no live session found for this process' });
        return;
      }
      const trimmed = args.trim();
      const [sub = '', ...tail] = trimmed.split(/\s+/);
      const rest = tail.join(' ');
      switch (sub.toLowerCase()) {
        case '':
          // No argument: report the state so the operator sees where they are
          // instead of silently toggling a mode that needs an objective.
          emit(ctx, KABMO_GOAL_STATE_MARKER, goalStateRecord(session));
          return;
        case 'show':
        case 'state':
          emit(ctx, KABMO_GOAL_STATE_MARKER, goalStateRecord(session));
          return;
        case 'pause':
          await dispatchGoal(api, session, ctx, 'pause', '');
          return;
        case 'resume':
          await dispatchGoal(api, session, ctx, 'resume', '');
          return;
        case 'drop':
          await dispatchGoal(api, session, ctx, 'drop', '');
          return;
        case 'budget':
          await dispatchGoal(api, session, ctx, 'budget', rest);
          return;
        case 'set':
        default:
          // `/goal <objective>` and `/goal set <objective>` are the same thing;
          // a bare `/goal set` with no text reports the state rather than
          // creating a goal with an empty objective.
          if (!rest.trim()) {
            emit(ctx, KABMO_GOAL_STATE_MARKER, goalStateRecord(session));
            return;
          }
          await dispatchGoal(api, session, ctx, 'create', JSON.stringify({ objective: rest.trim() }));
      }
    },
  });

  api.on?.('session_start', async (_event: unknown, ctx: ExtensionCtx) => {
    await restoreModes(api, ctx);
  });

  // A run that ended while a review was still parked means the tool call is
  // gone — Stop/abort is the only way in, since omp does NOT clear the proposal
  // handler when it interrupts (`setPlanProposalHandler(null)` appears only on
  // the plan-yolo approval path). Measured: after an abort the child reported
  // idle while the slot still held the plan, so `republish` kept re-announcing a
  // review nobody was waiting on and the composer's panel stayed up over a
  // finished run.
  //
  // Releasing is the same refinement `plan off` performs: the model learns the
  // review was abandoned rather than the operator's choice being invented. The
  // `clear: true` teardown would ALSO uninstall the handler, which a still-active
  // plan mode needs for the next `xd://propose`.
  api.on?.('agent_end', (event: unknown, ctx: ExtensionCtx) => {
    // A run that already scheduled a continuation is not over; its tool call may
    // still be the parked one.
    if ((event as { willContinue?: boolean }).willContinue === true) return;
    if (!peekParkedProposal()) return;
    releaseForRefinement('The run was interrupted before the plan was reviewed.');
    emit(ctx, KABMO_PLAN_DECISION_MARKER, { choice: 'Interrupted', title: '' });
  });

  // omp's own goal transitions are authoritative: Kabmo mirrors them and
  // persists the record so a reload can recover the goal without re-reading
  // `mode_change` (which rpc-ui never restores).
  api.on?.('goal_updated', (event: unknown, ctx: ExtensionCtx) => {
    const payload = event as { goal?: GoalRecord | null; state?: { enabled?: boolean } | null };
    const record = { goal: payload.goal ?? null, enabled: payload.state?.enabled === true };
    // One record per transition, so Kabmo's goal driver reads the state
    // it audits (and a reload recovers it) no matter who moved the goal: the
    // composer, the MODEL calling `goal({op:"create"})` after a guided
    // interview, or omp's own `/goal` typed in a TUI on the same session.
    api.appendEntry?.(KABMO_GOAL_STATE_ENTRY, record);
    emit(ctx, KABMO_GOAL_STATE_MARKER, record);
  });
}
