/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One subagent record as the timeline frames Kabmo already renders.
 *
 * The card is a `task` tool call inside its own assistant row, not a new
 * renderer: the transcript recorder, the fold and the reload path all already
 * understand `message_*` + `tool_execution_*`, so a child survives a reload and
 * needs no client change. The row id is derived from the CHILD's session id, so
 * every update patches one card instead of appending a new one.
 *
 * The frame set is emitted from a session-level object rather than through
 * `AcpFrameMapper`: a child outlives the parent turn (that is the RFD's whole
 * point), and the mapper's blocks are reset per turn. Closing the card here is
 * what stops it spinning once the child reports `idle`.
 */

import { subagentCardStatus, type AcpSubagentRecord, type SubagentCardStatus } from '@/server/lib/harness/acp/subagents';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';

export function subagentRowId(sessionId: string): string {
  return `subagent-${sessionId}`;
}

export function subagentToolCallId(sessionId: string): string {
  return `subagent:${sessionId}`;
}

/** The label the card's header and its task row both read. */
export function subagentLabel(record: AcpSubagentRecord): string {
  return record.title ?? record.description ?? 'Subagent';
}

function outputText(record: AcpSubagentRecord): string {
  const stateLine = record.stopReason
    ? `State: ${record.state} (${record.stopReason})`
    : `State: ${record.state}`;
  return [record.description, record.activity, stateLine, record.error ? `Error: ${record.error}` : '']
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n\n')
    .slice(0, 8_000);
}

function cardMessage(record: AcpSubagentRecord, completedAt?: number): Record<string, unknown> {
  const label = subagentLabel(record);
  return {
    role: 'assistant',
    id: subagentRowId(record.sessionId),
    timestamp: record.announcedAt,
    content: [{
      type: 'toolCall',
      id: subagentToolCallId(record.sessionId),
      name: 'task',
      arguments: {
        description: label,
        ...(record.description ? { prompt: record.description } : {}),
        ...(record.title ? { subagent_type: record.title } : {}),
      },
    }],
    ...(completedAt !== undefined
      ? { completedAt, duration: Math.max(0, completedAt - record.announcedAt) }
      : {}),
  };
}

/**
 * Frames for one update. `previous` is the status already shown, or null when
 * this is the child's first card — the only state that decides whether the row
 * is opened or patched.
 */
export function subagentFrames(record: AcpSubagentRecord, previous: SubagentCardStatus | null): AgentEvent[] {
  const status = subagentCardStatus(record);
  const toolCallId = subagentToolCallId(record.sessionId);
  const label = subagentLabel(record);
  const output = outputText(record);
  const message = cardMessage(record);
  const args = {
    description: label,
    ...(record.description ? { prompt: record.description } : {}),
    ...(record.title ? { subagent_type: record.title } : {}),
  };
  const frames: AgentEvent[] = [];

  if (previous === null) {
    frames.push({ type: 'message_start', message });
    frames.push({
      type: 'tool_execution_start',
      toolCallId,
      toolName: 'task',
      intent: label,
      args,
    });
  } else {
    frames.push({ type: 'message_update', message });
  }

  if (status === 'running') {
    frames.push({
      type: 'tool_execution_update',
      toolCallId,
      toolName: 'task',
      partialResult: { output },
      output,
    });
    return frames;
  }

  const completedAt = Date.now();
  frames.push({
    type: 'tool_execution_end',
    toolCallId,
    toolName: 'task',
    result: { output },
    isError: status === 'failed',
    output,
  });
  frames.push({ type: 'message_end', message: cardMessage(record, completedAt) });
  return frames;
}
