/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What one `session/update` does to an ACP session.
 *
 * Split out of the session class because the rules are about the protocol, not
 * about the process: metadata arrives BETWEEN turns (omp publishes its command
 * list and usage right after `session/new`), the agent's own title arrives
 * between turns too, and frames for a cancelled turn must be dropped before the
 * mapper can reopen a finalized message.
 *
 * The host is the narrow slice the rules need, so this can be tested without a
 * child and the session file stays under the size ceiling.
 */

import type { AgentEvent } from '@kabmo-labs/kabmo-omp/rpc-protocol/constants';
import type { HarnessCapabilities } from '@kabmo-labs/kabmo-harness/launch/capabilities';
import { noteAgentTitle } from '@kabmo-labs/kabmo-harness/session/session-title.server';
import { ACP_CONFIG_EFFECTS } from '@kabmo-labs/kabmo-acp/session-core/config-effects';
import { metadataCapabilities, parseAgentCommands, type AgentCommand } from '@kabmo-labs/kabmo-acp/session/session-facts';
import {
  adoptConfigList,
  publishConfigChange,
  stampMessageModel,
  type AcpConfigNotice,
} from '@kabmo-labs/kabmo-acp/session-config/session-config';
import type { AcpConfigOption, AcpProtocolVersion, AcpSessionModeState } from '@kabmo-labs/kabmo-acp/protocol/protocol';
import type { HarnessId } from '@kabmo-labs/kabmo-harness/catalog';
import { saveAcpPlanState } from '@kabmo-labs/kabmo-acp/session-core/acp-goal-state.server';
import { normalizeConfigOptions, planEntries } from '@kabmo-labs/kabmo-acp/protocol/v2';
import type { AcpSubagentRecord, AcpSubagents } from '@kabmo-labs/kabmo-acp/mapper/subagents';

export interface AcpNotificationHost extends AcpConfigNotice {
  /** The ACP session this stream belongs to; a frame naming another one is a
   *  child's and must not fold into this transcript. */
  readonly sessionId: string;
  readonly harness: HarnessId;
  /** The child sessions the parent has announced. */
  readonly subagents: AcpSubagents;
  /** Emit the card frames one child record changed. */
  subagentFrame(record: AcpSubagentRecord): void;
  /** The restore's own end marker (v2 `replay_complete`). */
  onReplayComplete(): void;
  /** The negotiated major; v2 renamed a few update payloads. */
  readonly protocol: AcpProtocolVersion;
  agentCommands: AgentCommand[];
  planEntries: unknown[];
  /** The older Session Modes API; updated when the agent switches itself. */
  modes: AcpSessionModeState | null;
  capabilities: HarnessCapabilities;
  messageCount: number;
  assistantCount: number;
  absorbUsage(update: Record<string, unknown>): void;
  acceptingFrames(): boolean;
  /** v2's turn boundary; a no-op on v1 and when no turn is open. */
  onStateUpdate(update: Record<string, unknown>): void;
  mapUpdate(update: Record<string, unknown>): AgentEvent[];
  emit(event: AgentEvent): void;
}

/** Apply one `session/update` notification, or ignore a different method. */
export function handleSessionNotification(
  host: AcpNotificationHost,
  method: string,
  params: Record<string, unknown>,
): void {
  if (method !== 'session/update') return;
  const update = params.update;
  if (!update || typeof update !== 'object') return;
  const record = update as Record<string, unknown>;
  const kind = typeof record.sessionUpdate === 'string' ? record.sessionUpdate : '';
  const frameSession = typeof params.sessionId === 'string' ? params.sessionId : '';

  // A child announces itself ON THE PARENT'S STREAM, and its own `sessionId` is
  // the CHILD — so this branch runs before the address gate.
  if (kind === 'subagent_update') {
    const announced = host.subagents.apply(record);
    if (announced) host.subagentFrame(announced);
    return;
  }

  // Every other update is ADDRESSED. A frame for another session is a child's
  // (or one this client never announced): fold it into its own card, or drop
  // it. Before this gate a multiplexing agent's child traffic merged into the
  // parent transcript and its permissions parked under the parent's id.
  if (frameSession && frameSession !== host.sessionId) {
    const child = host.subagents.absorb(frameSession, record);
    if (child) host.subagentFrame(child);
    return;
  }

  // v2's explicit end-of-replay marker. The fixed fallback in `AcpReplay` is
  // only for a peer that never sends one.
  if (kind === 'replay_complete') {
    host.onReplayComplete();
    return;
  }

  // Session METADATA arrives between turns — omp publishes its command list and
  // a usage update right after `session/new`, when no turn is open. The turn
  // gate below exists so abandoned output cannot reopen a finalized message;
  // applying it to these dropped the composer's `/` pool and the panels'
  // capability flags entirely.
  if (kind === 'available_commands_update') host.agentCommands = parseAgentCommands(record);
  if (kind === 'plan') host.planEntries = Array.isArray(record.entries) ? record.entries : [];
  if (kind === 'plan_update') host.planEntries = planEntries(record);
  if (kind === 'usage_update') host.absorbUsage(record);
  // v2's foreground lifecycle. `idle` closes the turn; it must reach the turn
  // machine even when the mapper has nothing to draw.
  if (kind === 'state_update') {
    host.onStateUpdate(record);
    return;
  }
  const absorbed = metadataCapabilities(host.capabilities, kind);
  if (absorbed !== host.capabilities) host.capabilities = absorbed;
  // The agent's own name for this chat arrives BETWEEN turns (measured on
  // claude: after the first answer), where the turn gate below would drop it.
  // Persisted here so the sidebar row can say it — and it outranks the guess
  // `notePromptTitle` made from the first prompt.
  if (kind === 'session_info_update' && typeof record.title === 'string' && host.sessionId) {
    void noteAgentTitle(host.sessionId, record.title);
  }
  // The agent can move a selector itself (a fallback, a dependent option after a
  // model switch). Its list is authoritative and arrives between turns, so it
  // is adopted BEFORE the turn gate below — the session, telemetry and the goal
  // audit must read the same model the client's `config_option_update` names.
  if (kind === 'config_option_update' && Array.isArray(record.configOptions)) {
    const options = host.protocol === 2
      ? normalizeConfigOptions(record.configOptions)
      : (record.configOptions as AcpConfigOption[]);
    adoptConfigList(host, options);
    publishConfigChange(host, undefined, ACP_CONFIG_EFFECTS);
    // v2 removed `current_mode_update`; a mode change arrives here. The
    // composer's Plan control reads the persisted flag, so mirror it.
    const mode = options.find((option) => option.category === 'mode');
    if (typeof mode?.currentValue === 'string') {
      void saveAcpPlanState(host.sessionId, mode.currentValue === 'plan').catch(() => {});
    }
  }
  // The agent moved its own mode (a plan-mode exit tool, a fallback). The
  // composer's Plan control reads the persisted flag rather than the frame
  // stream, so mirroring it here is what keeps the toggle truthful.
  if (kind === 'current_mode_update' && typeof record.currentModeId === 'string') {
    if (host.modes) host.modes = { ...host.modes, currentModeId: record.currentModeId };
    void saveAcpPlanState(host.sessionId, record.currentModeId === 'plan').catch(() => {});
  }
  // A notice is a LIVE user-facing event, not conversation output: the spec
  // allows it at any point while a session exists, and it requires the
  // `session.notices` capability this client now advertises. Applying the turn
  // gate below would have dropped exactly the notices that arrive between turns.
  if (kind === 'notice') {
    for (const event of host.mapUpdate(record)) host.emit(event);
    return;
  }

  // No turn open: the user stopped it (or one is still queued), and anything
  // the agent keeps emitting belongs to work nobody is watching. Forwarding it
  // reopened the assistant message after Stop and streamed abandoned text into
  // a transcript the client had already finalized.
  if (!host.acceptingFrames()) return;
  for (const event of host.mapUpdate(record)) {
    host.emit(stampMessageModel(event, host.runModel));
    if (event.type === 'message_end') {
      host.messageCount += 1;
      host.assistantCount += 1;
    }
  }
}
