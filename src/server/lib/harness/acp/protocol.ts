/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Agent Client Protocol wire shapes this host sends and reads.
 *
 * ONLY the fields Kabmo uses are typed. ACP is an open protocol with `_meta`
 * escape hatches and per-agent extras; typing the full schema would make every
 * adapter's newest field a compile error here, and the whole point of the
 * transport is that a new agent works without touching this file.
 *
 * Two rules the types encode, both measured against real agents:
 *
 *  - `session/update` is the ONLY stream of events. There is no `message_end`
 *    and no per-turn event envelope, so `messageId` is what delimits messages.
 *  - `tool_call_update` is a PATCH. Every field but `toolCallId` is optional and
 *    an omitted field means "unchanged", never "cleared".
 */

/** A JSON-RPC id. ACP forbids `null`, and replies echo whatever was sent. */
export type AcpId = string | number;

export interface AcpRequest {
  jsonrpc: '2.0';
  id: AcpId;
  method: string;
  params?: unknown;
}

export interface AcpNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface AcpError {
  code: number;
  message: string;
  data?: unknown;
}

export interface AcpResponse {
  jsonrpc: '2.0';
  id: AcpId;
  result?: unknown;
  error?: AcpError;
}

/** ACP `ToolKind`. The presentation category, and the mapper's renderer key. */
export type AcpToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other';

export type AcpToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface AcpToolLocation {
  path: string;
  line?: number;
}

/** One `tool_call` / `tool_call_update` payload. */
export interface AcpToolCallUpdate {
  sessionUpdate: 'tool_call' | 'tool_call_update';
  toolCallId: string;
  title?: string;
  name?: string;
  kind?: AcpToolKind;
  status?: AcpToolStatus;
  content?: unknown[];
  locations?: AcpToolLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface AcpContentBlock {
  type: 'text' | 'image' | 'audio' | 'resource' | 'resource_link';
  text?: string;
  data?: string;
  mimeType?: string;
}

/** `session/update` variants. Unknown variants arrive as `{ sessionUpdate: string }`. */
export interface AcpSessionUpdate {
  sessionUpdate: string;
  [key: string]: unknown;
}

export interface AcpSessionsUpdate extends AcpSessionUpdate {
  sessionUpdate: 'available_commands_update';
  availableCommands?: { name?: string; description?: string; input?: { hint?: string } | null }[];
}

export interface AcpConfigOption {
  id: string;
  name?: string;
  category?: string;
  type?: string;
  currentValue?: string | boolean;
  options?: ({ value: string; name?: string; description?: string } | { group: string; name?: string; options: { value: string; name?: string }[] })[];
}

export interface AcpSessionNewResult {
  sessionId: string;
  configOptions?: AcpConfigOption[];
  modes?: unknown;
}

export interface AcpInitializeResult {
  protocolVersion: number;
  agentInfo?: { name?: string; title?: string; version?: string };
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean };
    mcpCapabilities?: { http?: boolean; sse?: boolean };
    sessionCapabilities?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  };
  authMethods?: { id: string; name: string; description?: string; type?: string }[];
  _meta?: Record<string, unknown>;
}

export interface AcpSessionInfo {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
  _meta?: Record<string, unknown>;
}

/** `session/request_permission` — the approval gate's wire form. */
export interface AcpPermissionRequest {
  sessionId: string;
  toolCall?: { toolCallId?: string; title?: string; kind?: AcpToolKind; status?: AcpToolStatus; rawInput?: unknown; content?: unknown[] };
  options: { optionId: string; name?: string; kind?: string }[];
}

/** Flatten a select option list into values, ignoring groups. */
export function acpOptionValues(option: AcpConfigOption): string[] {
  const values: string[] = [];
  for (const entry of option.options ?? []) {
    if ('value' in entry) values.push(entry.value);
    else for (const nested of entry.options) values.push(nested.value);
  }
  return values;
}

/** The text of one content block, or '' for a non-text block. */
export function acpBlockText(block: unknown): string {
  if (!block || typeof block !== 'object') return '';
  const candidate = block as { type?: unknown; text?: unknown };
  return candidate.type === 'text' && typeof candidate.text === 'string' ? candidate.text : '';
}
