import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { resolveSessionPathOr404 } from '@/server/lib/omp/session/locator';
import { WebRpcError, getRpcSession, resolveSpawnCwd, startRpcSession, type AgentSessionWrapper } from '@/server/lib/omp/rpc/manager';
import { getSpawnApprovalMode, reconcileSpawnApprovalMode } from '@/server/lib/omp/rpc/session-registry';
import { isApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { loadPersistedAccessMode } from '@/shared/lib/omp/config/access-mode.server';
import { CONVERSATION_MOVING_COMMANDS, LIVE_RUN_COMMANDS, OBSERVER_ONLY_COMMANDS } from '@/server/lib/omp/rpc/constants';
import { rpcErrorResponse } from '@/server/lib/omp/rpc/errors';
import { assertBtwIdle } from '@/server/lib/btw/service.server';
import { loadPersistedModes } from '@/server/lib/omp/session/modes';
import { isModeCommandType, modeCommandPrompt, parseModeRequest, parseModeSelection } from '@/server/lib/omp/mode/request';
import { kabmoModeEnv } from '@/server/lib/omp/extensions/locator';
import { resetGoalDriverState } from '@/server/lib/omp/session/goal-driver.server';
import { forwardToPeer, isPeerRelayed, peerOriginForSession } from '@/server/lib/omp/rpc/peer-proxy.server';

/** How long after an accepted Resume Kabmo nudges the loop. The
 *  extension answers the mode command first; this only coalesces the nudge
 *  behind that answer (same 250 ms OpenChamber uses for its resume kickoff). */
const RESUME_KICKOFF_MS = 250;

// POST /api/agent/:sessionId — send a command to an existing session (or spawn
// it lazily). Mirrors omp-web's /api/agent/[id].
export async function sendCommand({ params, request }: ActionFunctionArgs) {
  const { sessionId } = params;
  if (!sessionId) return json({ error: 'session id is required' }, { status: 400 });

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.type !== 'string' || !body.type.trim()) {
      return json({ error: 'command type is required', code: 'command_type_required' }, { status: 400 });
    }

    // The session is running on ANOTHER Kabmo instance: relay this command
    // there instead of resuming the file here (which omp would fork). Checked
    // before any spawn decision, and never for a request that already hopped —
    // two instances that disagree would otherwise bounce it forever.
    if (!isPeerRelayed(request)) {
      const origin = await peerOriginForSession(sessionId);
      if (origin) return forwardToPeer(request, origin, body);
    }

    // A request with no explicit mode must never change a live session: use the
    // wrapper's spawned mode as ground truth. Falling back to the persisted
    // setting here would let an in-flight settings write clobber the mode the
    // client just spawned with (sendNewPrompt posts its follow-up prompt
    // without repeating accessMode). Only a real spawn uses the persisted
    // default. omp has no RPC to change the mode after spawn.
    const explicitMode = isApprovalMode(body.accessMode) ? body.accessMode : null;

    // A command that moves the conversation is refused while a side question is
    // in flight on this session — the question's snapshot describes the
    // transcript this command would replace (omp blocks the same operations).
    if (CONVERSATION_MOVING_COMMANDS.has(body.type)) {
      await assertBtwIdle(sessionId, body.type.replace(/_/g, ' '));
    }

    // Plan/Goal mode control. Translated to a `/kabmo-mode …` prompt for the
    // Kabmo-owned extension inside the child: no RPC verb exists for either
    // mode, and this path costs no transcript entry (the command is answered
    // locally). A live session is re-targeted in place — unlike the approval
    // mode, a mode change needs NO respawn.
    //
    // A session with no live child is spawned first, because the toggle is
    // usually the FIRST thing a user does on a reopened chat: the composer
    // renders from the persisted selection, and pressing the button is what
    // makes the child exist.
    const isModeRequest = isModeCommandType(body.type);
    const modeRequest = isModeRequest ? parseModeRequest(body) : null;
    if (isModeRequest && !modeRequest) {
      return json({ error: 'scope (plan|goal) and action are required', code: 'invalid_mode_request' }, { status: 400 });
    }
    // One translation, used by both dispatch paths below: a mode command is a
    // local extension command inside the child, never an RPC verb.
    const forwarded = modeRequest ? { type: 'prompt', message: modeCommandPrompt(modeRequest) } : body;

    // Fast path: already-running session.
    const existing = getRpcSession(sessionId);
    if (existing?.isAlive()) {
      // A mid-conversation change is honoured by destroying the idle process so
      // the spawn path below restarts it with the new --approval-mode flag.
      const liveMode = explicitMode ?? getSpawnApprovalMode(existing);
      if (!(await reconcileSpawnApprovalMode(existing, liveMode))) {
        const result = await existing.send(forwarded);
        // A Resume is the operator re-arming the loop: strike history from the
        // previous stop is not evidence about this run, and an idle session
        // should start working at once rather than wait for a user message
        // (the extension can only open the turn, Kabmo paces it).
        if (modeRequest?.scope === 'goal' && modeRequest.action === 'resume') {
          resetGoalDriverState(sessionId);
          setTimeout(() => {
            void existing.send({ type: 'prompt', message: modeCommandPrompt({ scope: 'goal', action: 'continue' }) });
          }, RESUME_KICKOFF_MS);
        }
        return json({ success: true, data: result });
      }
    }

    // Observer-only reads must never boot an omp child. This route is the spawn
    // path, so a roster snapshot (`get_subagents`) or a transcript page
    // (`get_subagent_messages`) posted for a session Kabmo is not
    // managing would start a whole process just to answer a read — measured:
    // opening a FINISHED session's roster row grew the omp process count, and
    // the sidebar renders those rows for every session in the list. Both reads
    // have RPC-free on-disk equivalents (`GET /api/sessions/:id/subagents[/:sub]`),
    // which is what a dead session is served from; the live registry is only
    // consulted while a process exists to answer for.
    if (OBSERVER_ONLY_COMMANDS.has(body.type)) {
      return json({ error: 'Session is not managed by Kabmo', code: 'session_not_running' }, { status: 409 });
    }
    // Same refusal for a stop: with no live wrapper here there is nothing to
    // stop, and the spawn path below would resume the session file just to
    // answer `abort` (see LIVE_RUN_COMMANDS).
    if (LIVE_RUN_COMMANDS[body.type]) {
      return json({ error: 'Session is not running', code: 'session_not_running' }, { status: 409 });
    }

    const resolved = await resolveSessionPathOr404(sessionId);
    if ('response' in resolved) return resolved.response;
    const { filePath, recordedCwd } = resolved;

    const cwd = await resolveSpawnCwd(recordedCwd);
    const spawnMode = explicitMode ?? await loadPersistedAccessMode();
    // The mode selection rides the spawn ENVIRONMENT, because `--mode rpc-ui`
    // never restores `mode_change` and the child's first command is the earliest
    // moment anything could re-apply it. Read from the session's own JSONL, so a
    // Kabmo restart, a second instance, or a CLI-driven session all agree.
    const persisted = body.modes !== undefined ? parseModeSelection(body as Record<string, unknown>) : await loadPersistedModes(filePath);
    const modeEnv = kabmoModeEnv({ plan: persisted.plan, goal: persisted.goal });
    // The model this command ASKS for is the best candidate to RESUME with: a
    // `set_model` carries the operator's own pick, and a session whose
    // recorded model no longer exists needs a replacement that resolves.
    const asked = body.type === 'set_model' && typeof body.provider === 'string' && typeof body.modelId === 'string'
      ? { provider: body.provider, modelId: body.modelId }
      : undefined;
    const { session } = await startRpcSession(sessionId, filePath, cwd, recordedCwd, spawnMode, modeEnv, asked);
    const result = await session.send(forwarded);
    // Same Resume nudge as the live path: a resumed goal must not sit idle
    // waiting for the operator's next message.
    if (modeRequest?.scope === 'goal' && modeRequest.action === 'resume') {
      resetGoalDriverState(sessionId);
      setTimeout(() => {
        void session.send({ type: 'prompt', message: modeCommandPrompt({ scope: 'goal', action: 'continue' }) });
      }, RESUME_KICKOFF_MS);
    }
    return json({ success: true, data: result });
  } catch (error) {
    return rpcErrorResponse(error);
  }
}

/** RPC-free view of a busy session. `state` carries only the two flags the
 *  attach probe reads; the full snapshot resumes once the turn settles. */
function busySessionPayload(session: AgentSessionWrapper) {
  return {
    running: true,
    busy: true,
    state: { isStreaming: session.streaming, isPromptRunning: session.promptRunning },
    pendingUiRequests: session.getPendingUiDialogs(),
  };
}

/** What a client needs to reattach: running flags, live state, blocked dialogs,
 *  and the child's own goal mirror. Shared by the HTTP probe and the realtime
 *  `session:<id>` snapshot so a reattaching tab gets one answer either way. */
export interface AgentSnapshot {
  running: boolean;
  busy?: boolean;
  state?: unknown;
  pendingUiRequests?: unknown[];
  goal?: { enabled: boolean; status?: string };
}

/**
 * The state a client needs to reattach to `sessionId`, WITHOUT spawning it.
 *
 * This is `getAgentState`'s body, lifted so the realtime topic's snapshot
 * resolver and the HTTP route cannot drift: both must answer "is it running,
 * what is it doing, is anything blocking it" identically, and the busy-session
 * shortcut (local flags, never a `get_state` that would queue behind the turn)
 * is exactly the kind of rule that silently diverges when duplicated.
 *
 * A session this process does not manage answers `running: false` — the caller
 * decides whether another instance owns it.
 */
export async function buildAgentSnapshot(sessionId: string): Promise<AgentSnapshot> {
  const session = getRpcSession(sessionId);
  if (!session || !session.isAlive()) return { running: false };

  // A busy session answers from local flags: its `get_state` would queue behind
  // the running turn (omp runs RPC handlers one at a time), and a timeout there
  // is no reason to reset a session that is demonstrably working — subagents
  // included. These flags are all the client needs to reattach its stream.
  //
  // The flags are also the ONLY evidence a stranded run ever leaves behind (a
  // non-terminal `agent_end` whose continuation never came), so they are given a
  // chance to settle before they are trusted. A live run pays nothing —
  // `RunSettle` probes only after 30s of quiet and settles only on omp's own
  // `isSettled`.
  if (session.isBusy()) {
    await session.runSettle.reconcile('request');
    if (session.isBusy()) return busySessionPayload(session) as AgentSnapshot;
  }

  try {
    const state = await session.send({ type: 'get_state' });
    // Dialogs omp is still blocked on: a client that reloaded mid-ask has no
    // other way to learn the request id it must answer, and omp never re-emits
    // the frame.
    return {
      running: true,
      state,
      pendingUiRequests: session.getPendingUiDialogs(),
      // The child's own goal state, read from the mirror so the composer's Goal
      // toggle reflects the CHILD rather than the client's last request.
      goal: { enabled: session.modeMirror.goalEnabled, status: session.modeMirror.goalStatus },
    };
  } catch (error) {
    if (error instanceof WebRpcError && error.code === 'session_unresponsive') {
      return { running: false };
    }
    // A turn started between the check above and the RPC: report busy, not dead.
    if (error instanceof WebRpcError && error.code === 'session_busy') {
      return busySessionPayload(session) as AgentSnapshot;
    }
    throw error;
  }
}

// GET /api/agent/:sessionId — current agent state (running set + live state).
export async function getAgentState({ params, request }: LoaderFunctionArgs) {
  const { sessionId } = params;
  if (!sessionId) return json({ error: 'session id is required' }, { status: 400 });

  const session = getRpcSession(sessionId);
  if (!session || !session.isAlive()) {
    // Another instance may be running it. Without this the client reads
    // `running: false`, never reattaches its stream, and shows a timeline that
    // does not move while the owner streams — the exact symptom the peer bridge
    // exists to remove.
    if (!isPeerRelayed(request)) {
      const origin = await peerOriginForSession(sessionId);
      if (origin) return forwardToPeer(request, origin);
    }
    return json({ running: false });
  }

  try {
    return json(await buildAgentSnapshot(sessionId));
  } catch (error) {
    return rpcErrorResponse(error);
  }
}
