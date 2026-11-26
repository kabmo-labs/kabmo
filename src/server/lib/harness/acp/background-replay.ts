/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What one `session/load` replay added, and the notice that says it.
 *
 * A replay repeats the WHOLE conversation, so the probe's job is to find the
 * part past the answer the operator already has. Two kinds of evidence matter,
 * and the second was missing until a real chat proved it was needed:
 *
 *  - **prose** — an `agent_message_chunk` past the baseline. Already handled.
 *  - **work** — a `tool_call` past the baseline. Measured on agy 1.5.3 against a
 *    finished 155 s run: the held replay carried `read_file` and a failed
 *    `run_command` AFTER the holding sentence and no new assistant text at all,
 *    so a probe that waited for prose delivered nothing before its ceiling.
 *
 * Both are reported once per call id, so a probe that runs every few seconds
 * does not repeat the same notice.
 */

import { acpContentText } from '@kabmo-labs/kabmo-acp-mapper/mapper';
import { resolveToolIdentity } from '@kabmo-labs/kabmo-acp-mapper/tool-identity';

/** One tool call a replay added past the baseline. */
export interface ReplayTool {
  id: string;
  name: string;
  status: string;
}

/** Replay chunks collected since the last `user_message_chunk`. */
export interface ReplaySegment {
  text: string;
  sawUser: boolean;
  tools: ReplayTool[];
}

/** How many tool rows one notice lists before it summarizes. */
const MAX_LISTED = 5;

/** The notice for tool calls this probe has not reported yet, or null. */
export function newToolNotice(segment: ReplaySegment, reported: Set<string>): string | null {
  const fresh = segment.tools.filter((tool) => !reported.has(tool.id));
  if (fresh.length === 0) return null;
  for (const tool of fresh) reported.add(tool.id);
  const lines = fresh.map((tool) => {
    const mark = tool.status === 'completed' ? '✓' : tool.status === 'failed' ? '✗' : '·';
    return `${mark} ${tool.name}`;
  });
  const shown = lines.slice(0, MAX_LISTED);
  const more = lines.length - shown.length;
  return ['The subagent continued working:', ...shown, ...(more > 0 ? [`… and ${more} more`] : [])].join('\n');
}

/** Apply one `session/update` payload to the open segment. */
export function collectReplayFrame(segment: ReplaySegment, update: unknown): void {
  if (!update || typeof update !== 'object') return;
  const record = update as Record<string, unknown>;
  const kind = typeof record.sessionUpdate === 'string' ? record.sessionUpdate : '';
  if (kind === 'user_message_chunk') {
    // A new user turn starts a new assistant segment; everything before it is
    // history this probe does not need. The TOOLS reset with the text — a
    // replay repeats every call of the chat, and reporting those as "the
    // subagent continued working" told the operator about turns that had
    // already finished (measured on the real agy replay: seven calls listed,
    // five of them from earlier turns).
    segment.text = '';
    segment.tools = [];
    segment.sawUser = true;
    return;
  }
  if (kind === 'agent_message_chunk') {
    segment.text += acpContentText(record.content);
    return;
  }
  if (kind !== 'tool_call' && kind !== 'tool_call_update') return;
  const id = typeof record.toolCallId === 'string' ? record.toolCallId : '';
  if (!id) return;
  // The SAME identity rule the card uses: a replay of zcode (`_meta.claudeCode`),
  // qwen (`_meta.toolName`), grok (`_meta["x.ai/tool"]`) or kimi (title prefix)
  // names its tool nowhere the top level can see, so reading `record.name`
  // alone reported the notice as `Agent: …` or a bare `tool`.
  const identity = resolveToolIdentity(record);
  const name = identity.name
    ?? (typeof record.title === 'string' && record.title ? record.title : 'tool');
  const status = typeof record.status === 'string' ? record.status : 'pending';
  const existing = segment.tools.find((tool) => tool.id === id);
  // A `tool_call_update` patches the call: keep its first name and take the
  // latest status, so one call is one row.
  if (existing) {
    existing.status = status;
    return;
  }
  segment.tools.push({ id, name, status });
}
