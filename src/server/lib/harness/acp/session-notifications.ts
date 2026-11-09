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

import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import type { HarnessCapabilities } from '@/server/lib/harness/capabilities';
import { noteAgentTitle } from '@/server/lib/harness/session-title.server';
import { metadataCapabilities, parseAgentCommands, type AgentCommand } from '@/server/lib/harness/acp/session-facts';
import {
  adoptConfigList,
  publishConfigChange,
  stampMessageModel,
  type AcpConfigNotice,
} from '@/server/lib/harness/acp/session-config';
import type { AcpConfigOption } from '@/server/lib/harness/acp/protocol';
import type { HarnessId } from '@/shared/lib/harness/catalog';

export interface AcpNotificationHost extends AcpConfigNotice {
  readonly harness: HarnessId;
  agentCommands: AgentCommand[];
  planEntries: unknown[];
  capabilities: HarnessCapabilities;
  messageCount: number;
  assistantCount: number;
  absorbUsage(update: Record<string, unknown>): void;
  acceptingFrames(): boolean;
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

  // Session METADATA arrives between turns — omp publishes its command list and
  // a usage update right after `session/new`, when no turn is open. The turn
  // gate below exists so abandoned output cannot reopen a finalized message;
  // applying it to these dropped the composer's `/` pool and the panels'
  // capability flags entirely.
  if (kind === 'available_commands_update') host.agentCommands = parseAgentCommands(record);
  if (kind === 'plan') host.planEntries = Array.isArray(record.entries) ? record.entries : [];
  if (kind === 'usage_update') host.absorbUsage(record);
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
    adoptConfigList(host, record.configOptions as AcpConfigOption[]);
    publishConfigChange(host);
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
