/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Read a Codex session's transcript from its own rollout file.
 *
 * WHY THIS EXISTS: a Codex session that is still open in the terminal (or the
 * IDE) refuses `session/resume` with `thread_active_writer`. Kabmo cannot
 * replay it through ACP, and the user sees an empty chat for a conversation
 * they are looking at in the terminal. The rollout is the only copy that can be
 * read while another client holds the thread, so it is the display fallback for
 * an imported chat with no local transcript.
 *
 * It is a READER, never a second discovery convention: the sidebar row still
 * comes from `session/list`. The file is read only when the user opens that row.
 *
 * The record shape is Codex's own (`session_meta` + `response_item` items).
 * Developer/system scaffolding and the `<environment_context>` user turn are
 * dropped: they are prompts Codex wrote to itself, not the conversation.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadHarnessConfig } from '@/server/lib/harness/config.server';
import type { ChatMessageData, ToolCallData, ToolType } from '@/shared/types/chat';

/** The Codex data root, from the harness config's `CODEX_HOME` or `~/.codex`. */
export async function codexHome(): Promise<string> {
  const configured = await loadHarnessConfig('codex').catch(() => null);
  const env = configured?.env ?? '';
  const line = /^\s*(?:export\s+)?CODEX_HOME\s*=\s*(.+?)\s*$/m.exec(env)?.[1];
  const fromConfig = line?.replace(/^['"]|['"]$/g, '').trim();
  // The child inherits Bun.env as well, so a process-level CODEX_HOME decides
  // where the agent reads too.
  const fromProcess = process.env.CODEX_HOME?.trim();
  return fromConfig || fromProcess || join(homedir(), '.codex');
}

/** The rollout file for one session id, or null. */
export async function findCodexRollout(sessionId: string): Promise<string | null> {
  if (!/^[A-Za-z0-9-]{1,80}$/.test(sessionId)) return null;
  const home = await codexHome();
  const glob = new Bun.Glob(`sessions/**/rollout-*${sessionId}.jsonl`);
  for await (const path of glob.scan({ cwd: home, absolute: true, onlyFiles: true })) return path;
  return null;
}

/** One line's timestamp, as the ISO string the timeline's `date` reads. */
function timestampOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Text from Codex's `content[]` blocks. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((block) => (isRecord(block) && typeof block.text === 'string' ? [block.text] : []))
    .join('\n');
}

/** Harness scaffolding Codex writes as a user turn, never the operator's words. */
function isScaffolding(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length === 0
    || trimmed.startsWith('<environment_context>')
    || trimmed.startsWith('<user_instructions>')
    || trimmed.startsWith('<turn_aborted>')
    || trimmed.startsWith('<permissions instructions>');
}

/** The closest Kabmo tool type for a Codex tool name. */
function toolTypeFor(name: string): ToolType {
  const lower = name.toLowerCase();
  if (/shell|exec|command|terminal/.test(lower)) return 'bash';
  if (/patch|edit|write/.test(lower)) return 'edit';
  if (/read|view|open/.test(lower)) return 'read';
  if (/grep|search/.test(lower)) return 'grep';
  if (/web|fetch|browse/.test(lower)) return 'web_search';
  return 'custom';
}

/** A plain string for a `function_call_output`-style payload. */
function outputText(payload: Record<string, unknown>): string {
  const output = payload.output;
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return textOf(output);
  if (isRecord(output) && typeof output.content === 'string') return output.content;
  return '';
}

function commandOf(payload: Record<string, unknown>): string | undefined {
  const action = isRecord(payload.action) ? payload.action : null;
  const actionCommand = action?.command;
  if (Array.isArray(actionCommand)) return actionCommand.filter((part) => typeof part === 'string').join(' ');
  if (typeof actionCommand === 'string') return actionCommand;
  const args = payload.arguments;
  if (typeof args === 'string') {
    try {
      const parsed: unknown = JSON.parse(args);
      if (isRecord(parsed) && typeof parsed.command === 'string') return parsed.command;
      if (isRecord(parsed) && Array.isArray(parsed.command)) return parsed.command.join(' ');
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * The rows one rollout body produces. Pure, so the mapping is testable from a
 * fixture without a Codex install.
 */
export function codexMessagesFromRollout(body: string): ChatMessageData[] {
  const messages: ChatMessageData[] = [];
  const calls = new Map<string, ToolCallData>();
  let currentAssistant: ChatMessageData | null = null;

  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) continue;
      record = parsed;
    } catch {
      continue;
    }
    if (record.type !== 'response_item' || !isRecord(record.payload)) continue;
    const payload = record.payload;
    const kind = typeof payload.type === 'string' ? payload.type : '';
    const timestamp = timestampOf(record.timestamp);
    const id = typeof payload.id === 'string' ? payload.id : undefined;

    if (kind === 'message') {
      const role = typeof payload.role === 'string' ? payload.role : '';
      const text = textOf(payload.content).trim();
      if (role === 'user') {
        if (isScaffolding(text)) continue;
        messages.push({
          id: id ?? `codex-user-${messages.length}`,
          role: 'user',
          content: text,
          ...(timestamp ? { date: timestamp, timestamp } : {}),
        });
        currentAssistant = null;
        continue;
      }
      if (role === 'assistant') {
        if (!text) continue;
        const row: ChatMessageData = {
          id: id ?? `codex-ai-${messages.length}`,
          role: 'ai',
          content: text,
          ...(timestamp ? { date: timestamp, timestamp } : {}),
        };
        messages.push(row);
        currentAssistant = row;
      }
      continue;
    }

    if (kind === 'function_call' || kind === 'local_shell_call' || kind === 'custom_tool_call') {
      const name = typeof payload.name === 'string' ? payload.name : 'shell';
      const callId = typeof payload.call_id === 'string' && payload.call_id
        ? payload.call_id
        : `codex-call-${calls.size + 1}`;
      const command = commandOf(payload);
      const call: ToolCallData = {
        id: callId,
        type: toolTypeFor(name),
        title: name,
        name,
        ...(command ? { command } : {}),
        ...(typeof payload.arguments === 'string' ? { input: payload.arguments } : {}),
        status: 'aborted',
        ...(timestamp ? { startedAt: Date.parse(timestamp) || undefined } : {}),
      };
      calls.set(callId, call);
      if (!currentAssistant) {
        currentAssistant = {
          id: `codex-ai-${messages.length}`,
          role: 'ai',
          content: '',
          ...(timestamp ? { date: timestamp, timestamp } : {}),
        };
        messages.push(currentAssistant);
      }
      currentAssistant.toolCalls = [...(currentAssistant.toolCalls ?? []), call];
      continue;
    }

    if (kind === 'function_call_output' || kind === 'local_shell_call_output' || kind === 'custom_tool_call_output') {
      const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
      const call = calls.get(callId);
      if (!call) continue;
      const output = outputText(payload);
      call.output = output;
      const failed = payload.is_error === true || payload.success === false;
      call.status = failed ? 'error' : 'success';
      if (failed && !call.error && output) call.error = output;
    }
  }
  return messages;
}

/** Read the imported session's rollout, or [] when it has none / cannot parse. */
export async function readCodexRolloutTranscript(sessionId: string): Promise<ChatMessageData[]> {
  const path = await findCodexRollout(sessionId).catch(() => null);
  if (!path) return [];
  try {
    return codexMessagesFromRollout(await Bun.file(path).text());
  } catch {
    return [];
  }
}
