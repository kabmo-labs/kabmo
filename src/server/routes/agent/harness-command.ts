/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two command paths that only exist because a chat can run on a harness
 * that is NOT omp: restoring one that has no session file, and answering a mode
 * command where the `/kabmo-mode` extension does not exist.
 *
 * Both are dispatched from `routes/agent/command.ts` and both answer the same
 * shapes a live omp session does, so the client cannot tell which transport
 * served a command.
 */

import { freshProbe } from '@kabmo-labs/kabmo-harness/config-store/probe-cache.server';
import { startAcpSession, takeAcpReplayEvents } from '@/server/lib/harness/spawn.server';
import { mintAgentEnvironment, rememberAgentToken } from '@kabmo-labs/kabmo-session/relations/agent-token.server';
import {
  knownHarness, loadHarnessSession, loadHarnessSessionTitle, repointHarnessSession,
  type HarnessSessionRecord,
} from '@kabmo-labs/kabmo-harness/session/session-store.server';
import { transcriptFromReplay } from '@kabmo-labs/kabmo-acp/session-core/replay-transcript';
import { getDb } from '@/server/db.server';
import { selectValues } from '@kabmo-labs/kabmo-harness/launch/launch';
import { harnessOfSession } from '@/server/lib/omp/rpc/session-registry';
import { emitRealtimeSignal } from '@kabmo-labs/kabmo-realtime-signals';
import { HARNESS_IDS, harnessDescriptor } from '@kabmo-labs/kabmo-harness/catalog';
import type { AcpConfigOption } from '@kabmo-labs/kabmo-acp/protocol/protocol';
import { applyAcpGoalAction, type AcpGoalHost } from '@kabmo-labs/kabmo-acp/session-core/acp-goal.server';
import { saveAcpPlanState } from '@kabmo-labs/kabmo-acp/session-core/acp-goal-state.server';
import type { HarnessSession } from '@kabmo-labs/kabmo-harness/contract';
import type { ModeRequest } from '@kabmo-labs/kabmo-omp/mode-request';
import type { ApprovalMode } from '@kabmo-labs/kabmo-omp/access-mode';
import { hasAssistantRow } from '@kabmo-labs/kabmo-chat/rows/transcript-rows';

/**
 * Respawn the ACP session a recorded non-omp chat belongs to, or null when this
 * is not one.
 *
 * The caller dispatches to the returned session exactly as it does to one that
 * never stopped, which is what makes "open an old chat and keep talking" work
 * for a harness whose agent writes no session file.
 *
 * Two refusals are deliberate:
 *
 *  - an id this build's catalog no longer lists spawns NOTHING (a retired
 *    adapter must not be guessed at from a stale row);
 *  - a harness whose probe says it can neither `session/load` nor
 *    `session/resume` is refused in words, because the only alternative is
 *    starting a FRESH agent session under this chat's id — which would silently
 *    throw the conversation away.
 *
 * `omp-acp` is excluded even though ACP is what it speaks. It WRITES a session
 * file, so the locator resumes it in place over RPC — the same chat, the same
 * id, one row. `session/load` on omp FORKS (measured: a load for `01a1b49f-…`
 * answered id `01a1b4cc-…`), and a forked id is a second record — a second
 * sidebar row for one conversation, which is the defect the merge rule in
 * `sidebar-data.server.ts` exists to prevent. The recorded mark is rewritten to
 * `omp-rpc` on that path, which is truthful: RPC is then the transport that ran
 * it.
 */
export async function resumeRecordedHarnessSession(
  sessionId: string,
  accessMode: ApprovalMode | null,
): Promise<HarnessSession | null> {
  const record = await loadHarnessSession(sessionId);
  const harness = knownHarness(record?.harness, HARNESS_IDS);
  if (!record || !harness || harness === 'omp-rpc' || harness === 'omp-acp' || !record.cwd) return null;

  const label = harnessDescriptor(harness)?.label ?? harness;
  const probe = await freshProbe(harness);
  // A BLOCKED probe is not evidence about capabilities: it was measured in a
  // different auth state (`codex` answered "Authentication required" before the
  // user logged in). Refusing on it locked a chat that could already resume.
  if (probe && !probe.capabilities.blocked && !probe.capabilities.loadSession && !probe.capabilities.resumeSession) {
    throw new Error(`${label} cannot restore this chat: it supports neither session/load nor session/resume.`);
  }
  const { token, env } = mintAgentEnvironment();
  const { session, realSessionId } = await startAcpSession({
    harness,
    sessionId,
    // The AGENT's own id, stored because ACP may answer a different one than
    // the caller asked for. `session/load` needs the agent's, never Kabmo's —
    // and an EMPTY stored id means "the same as ours" (`saveHarnessSession`
    // writes it blank in exactly that case), so the row's own id is the value to
    // send. Passing '' here would silently start a FRESH agent session under
    // this chat's id and throw the conversation away.
    resumeAgentSessionId: record.agentSessionId || sessionId,
    cwd: record.cwd,
    accountId: record.accountId || null,
    accessMode,
    env,
  });
  await rememberAgentToken(sessionId, token).catch((cause: unknown) => {
    console.error(`[sessions] could not record the agent token for ${sessionId}:`, cause);
  });
  // A forking load answers a NEW agent id, and the spawn recorded that id as its
  // own row — a second sidebar row for one conversation. The chat keeps ITS id
  // (the tab, the transcript and the layout all name it) and adopts the agent's.
  await repointHarnessSession(sessionId, realSessionId).catch(() => {});
  if (realSessionId !== sessionId) emitRealtimeSignal('sidebar-structure');
  return session;
}

/**
 * Whether a recorded chat can be replayed into Kabmo's transcript.
 *
 * The gate is the LOCAL TRANSCRIPT, not `origin`: an imported chat has none,
 * and neither does a child Kabmo spawned SERVER-SIDE (an orchestration worker,
 * a CLI child) — no tab ever wrote its turns. A chat with an assistant row
 * already has the conversation and must not replay it twice.
 */
export function restoreEligible(record: HarnessSessionRecord | null, localMessages: unknown): boolean {
  if (!record || !record.cwd) return false;
  if (record.harness === 'omp-rpc') return false;
  return !hasAssistantRow(localMessages);
}

/**
 * Replay a chat's retained history into Kabmo's own transcript.
 *
 * The sidebar shows a row because `harness_sessions` lists it, but the agent
 * holds the conversation: Kabmo never received those turns, so the open tab
 * would be empty. A v2 agent replays its history when `session/resume` carries
 * `replayFrom`; the frames are collected before the session is usable and
 * reduced to the rows the timeline reads. Persisting the result is the point of
 * the exercise — every later open is an ordinary read.
 */
export async function restoreRecordedHarnessSession(
  sessionId: string,
  accessMode: ApprovalMode | null,
): Promise<{ session: HarnessSession; harness: string; messages: number } | null> {
  const record = await loadHarnessSession(sessionId);
  const harness = knownHarness(record?.harness, HARNESS_IDS);
  if (!record || !harness) return null;

  const db = await getDb();
  const existing = (await db.get('SELECT messages FROM chat_sessions WHERE session_id = ?', [sessionId])) as {
    messages?: string;
  } | null;
  let localMessages: unknown = [];
  if (existing?.messages) {
    try {
      localMessages = JSON.parse(existing.messages);
    } catch {
      // A corrupt local copy is not a transcript: replay and replace it.
      localMessages = [];
    }
  }
  if (!restoreEligible(record, localMessages)) return null;

  const probe = await freshProbe(harness);
  const label = harnessDescriptor(harness)?.label ?? harness;
  if (probe && !probe.capabilities.blocked && !probe.capabilities.loadSession && !probe.capabilities.resumeSession) {
    throw new Error(`${label} cannot replay this chat: it supports neither session/load nor session/resume.`);
  }
  const { token, env } = mintAgentEnvironment();
  const { session, realSessionId } = await startAcpSession({
    harness,
    sessionId,
    resumeAgentSessionId: record.agentSessionId || sessionId,
    cwd: record.cwd,
    accountId: record.accountId || null,
    accessMode,
    env,
    replay: true,
  });
  await rememberAgentToken(sessionId, token).catch((cause: unknown) => {
    console.error(`[sessions] could not record the agent token for ${sessionId}:`, cause);
  });
  await repointHarnessSession(sessionId, realSessionId).catch(() => {});
  if (realSessionId !== sessionId) emitRealtimeSignal('sidebar-structure');

  const messages = transcriptFromReplay(takeAcpReplayEvents(session));
  if (messages.length > 0) {
    const title = (await loadHarnessSessionTitle(sessionId).catch(() => '')) || `Session ${sessionId}`;
    await db.run(
      'INSERT OR REPLACE INTO chat_sessions (session_id, title, messages, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [sessionId, title, JSON.stringify(messages)],
    );
  }
  return { session, harness, messages: messages.length };
}

/**
 * Answer a mode command on a harness that has no `/kabmo-mode` extension.
 *
 * Forwarding the extension prompt to any other agent made the MODEL read
 * `/kabmo-mode plan on` as prose and opened a turn with it (measured on claude,
 * whose next mode command was then refused as "already processing"). Its own
 * ACP `mode` selector is the honest equivalent: `plan` is a value where the
 * agent implements one, and a scope it cannot express is refused in words.
 */
export async function applyHarnessMode(
  session: HarnessSession,
  request: ModeRequest,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const harness = harnessOfSession(session);
  const label = harnessDescriptor(harness)?.label ?? harness;
  if (request.scope === 'goal') {
    // Kabmo owns the record and the loop for every ACP transport (see
    // `acp-goal.server.ts`); the agent needs no extension for it.
    return applyAcpGoalAction(session as unknown as AcpGoalHost, request);
  }
  const state = (await session.send({ type: 'get_state' })) as { configOptions?: unknown } | undefined;
  const options = Array.isArray(state?.configOptions) ? state.configOptions : [];
  const selector = options.find(
    (option): option is AcpConfigOption =>
      typeof option === 'object' && option !== null && 'category' in option && option.category === 'mode',
  );
  const values = selectValues(selector).map((entry) => entry.value);
  if (request.action !== 'on' && request.action !== 'off') {
    const enabled = selector?.currentValue === 'plan';
    // Mirror it: a dead ACP session has no selector left to ask, and the
    // composer must still show the mode it was in.
    void saveAcpPlanState(session.sessionId, enabled);
    return { ok: true, data: { enabled } };
  }
  if (!values.includes('plan')) return { ok: false, error: `${label} has no plan mode` };
  // `default` is the value every measured agent uses for "no special mode"; the
  // first non-plan value is the fallback for an agent that names it differently.
  const target = request.action === 'on'
    ? 'plan'
    : values.find((value) => value === 'default') ?? values.find((value) => value !== 'plan');
  if (!target) return { ok: false, error: `${label} has no plan mode` };
  const data = await session.send({ type: 'set_mode', mode: target });
  void saveAcpPlanState(session.sessionId, target === 'plan');
  return { ok: true, data };
}
