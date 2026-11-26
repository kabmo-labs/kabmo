/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ONE classification of a tool call into a renderer family.
 *
 * What was wrong: the client decided the panel from `tool.name` (with a closed
 * alias table), while `type` was inferred separately from the same name, and
 * the ACP producer decided it a third time from `kind`. The three answers could
 * disagree — a `kind:"other"` call carrying a title produced `type:"bash"` and
 * no panel, because the panel lookup never read `type`. The same logical shell
 * call therefore drew a Bash card on one harness and a generic Input/Output
 * body on another.
 *
 * This module is pure and shared so the SERVER can run it once at ingress:
 * ACP tool blocks, omp frames and stored transcripts all get the same answer,
 * and the client only consumes `ToolRender` (see `shared/types/chat.ts`).
 *
 * Rules, in order (each one is a measured adapter shape):
 *  1. `proc://` in the target or input path — the URL names the operation.
 *  2. a read of a tool-documentation URL (`help://`, older `xd://`).
 *  3. a bash call that IS one tool command (`resolve "…"`, `lsp --help`).
 *  4. a virtual-device call (`write xd://lsp`, an `mcp__` name).
 *  5. the tool's own name, folded through the agent-vocabulary aliases.
 *  6. the adapter's `kind` (ACP's ten values) when no name names a panel.
 *  7. a conservative substring inference from the name/title.
 * Anything else is `custom`, which the body renders as JSON.
 */

import type { ToolCallData, ToolType } from '@kabmo-labs/kabmo-chat-contracts/chat';
import type { ToolRender, ToolRenderKey } from '@kabmo-labs/kabmo-chat-contracts/tool-render';
import { procPathOf } from '@kabmo-labs/kabmo-omp-proc/proc';
import { soleToolCommand } from './tool-commands';
import { canonicalAgentToolName } from './tool-aliases';
import { isRecord } from '@kabmo-labs/kabmo-guards';

export interface ToolRenderInput {
  name?: string;
  title?: string;
  type?: string;
  /** ACP `kind` — `read`/`edit`/`execute`/`other`/… */
  kind?: string;
  rawKind?: string;
  input?: unknown;
  target?: string;
  command?: string;
  details?: unknown;
}

/** Legacy names Kabmo's own surfaces (MOCK path, old transcripts) spell. */
export const LEGACY_TOOL_ALIASES: Readonly<Record<string, string>> = {
  read_file: 'read',
  view_file: 'read',
  read_file_content: 'read',
  edit_file: 'edit',
  create_file: 'write',
  write_to_file: 'write',
  replace_file_content: 'edit',
  multi_edit_file: 'edit',
  terminal: 'bash',
  run_command: 'bash',
  ast_grep: 'grep',
  new_context: 'context_notes',
  rewind: 'checkpoint',
  retain: 'memory_edit',
  recall: 'memory_edit',
  reflect: 'memory_edit',
  learn: 'memory_edit',
  yield: 'goal',
};

/** Name -> panel family. The census is the client's panel registry. */
const PANEL_KINDS: Readonly<Record<string, ToolRenderKey>> = {
  read: 'read', edit: 'edit', write: 'write', bash: 'bash', eval: 'eval',
  grep: 'grep', glob: 'grep', search_fs: 'search_fs',
  todo: 'todo', task: 'task', web_search: 'web_search',
  // Delegation spellings: a child agent is a `task` card, not a file read.
  // These are the same names `tool-identity.ts` recognises as delegations.
  spawn_subagent: 'task', invoke_subagent: 'task', spawn_agent: 'task',
  delegate: 'task', subagent: 'task', agent: 'task',
  lsp: 'lsp', ast_edit: 'ast_edit', resolve: 'resolve', reject: 'reject',
  hub: 'proc', github: 'github', checkpoint: 'checkpoint',
  security_scan: 'security_scan', debug: 'debug', manage_skill: 'manage_skill',
  context_notes: 'context_notes', memory_edit: 'memory_edit', goal: 'goal',
  ask: 'ask', think: 'think', wait: 'wait',
};

/** Devices whose panel is not named after the device itself. */
const DEVICE_KINDS: Readonly<Record<string, ToolRenderKey>> = {
  ast_grep: 'grep',
  resolve: 'resolve',
  reject: 'reject',
  lsp: 'lsp',
  ast_edit: 'ast_edit',
  debug: 'debug',
};

/** ACP's ten-kind vocabulary -> the renderer family it names, when it names
 *  one. `switch_mode` stays unclassified: a plan-mode toggle is not a todo
 *  list, and drawing one was the old bug. */
const KIND_KEYS: Readonly<Record<string, ToolRenderKey>> = {
  read: 'read',
  edit: 'edit',
  delete: 'edit',
  move: 'edit',
  search: 'grep',
  execute: 'bash',
  think: 'think',
  fetch: 'web_search',
};

export const TOOL_RENDER_KEYS: readonly ToolRenderKey[] = [
  'read', 'edit', 'write', 'bash', 'eval', 'grep', 'search_fs', 'todo', 'task',
  'web_search', 'lsp', 'ast_edit', 'resolve', 'reject', 'proc', 'github',
  'checkpoint', 'security_scan', 'debug', 'manage_skill', 'context_notes',
  'memory_edit', 'goal', 'ask', 'think', 'mcp', 'wait', 'custom',
];

const RENDER_KEY_SET: Readonly<Record<string, true>> = Object.fromEntries(
  TOOL_RENDER_KEYS.map((key) => [key, true]),
);

/** Whether a wire value names a renderer family this build knows. */
export function isToolRenderKey(value: unknown): value is ToolRenderKey {
  return typeof value === 'string' && RENDER_KEY_SET[value] === true;
}

/** The `xd://<device>` an omp virtual-device call targets, if any. */
export function xdDevice(tool: { name?: string; type?: string; target?: string; input?: unknown }): string | undefined {
  const input = isRecord(tool.input) ? tool.input : undefined;
  const path = typeof input?.path === 'string' ? input.path : tool.target ?? '';
  if (!path.startsWith('xd://')) return undefined;
  return path.slice('xd://'.length).split(/[/?#\s]/)[0].toLowerCase() || undefined;
}

/** The documentation URL a READ names, if any. Both spellings are read:
 *  `help://` is current, `xd://` predates omp 19.1.0 and still appears in
 *  recorded transcripts. */
export function xdDocPath(tool: ToolCallData): string | undefined {
  const raw = canonicalAgentToolName(tool.name || tool.type || '').toLowerCase();
  if ((LEGACY_TOOL_ALIASES[raw] ?? raw) !== 'read') return undefined;
  const input = isRecord(tool.input) ? tool.input : undefined;
  const path = typeof input?.path === 'string' ? input.path : tool.target ?? '';
  return path.startsWith('xd://') || path.startsWith('help://') ? path : undefined;
}

export function isXdDocRead(tool: ToolCallData): boolean {
  return xdDocPath(tool) !== undefined;
}

/** The call described as the client's data shape, so the shared helpers above
 *  can read it. Only classification facts are filled. */
function candidate(input: ToolRenderInput): ToolCallData {
  const type = (input.type ?? '') as ToolType;
  return {
    id: 'render',
    type,
    title: input.title ?? '',
    ...(input.name ? { name: input.name } : {}),
    ...(input.target ? { target: input.target } : {}),
    ...(input.command ? { command: input.command } : {}),
    ...(input.input !== undefined ? { input: input.input as ToolCallData['input'] } : {}),
    ...(isRecord(input.details) ? { details: input.details } : {}),
  };
}

/** omp's legacy substring rules, narrowed to "no better fact exists". */
function inferFromText(text: string): ToolRenderKey | null {
  const lower = text.toLowerCase();
  if (!lower) return null;
  if (lower.includes('bash') || lower.includes('terminal') || lower.includes('shell') || lower.includes('run')) return 'bash';
  if (lower.includes('write') || lower.includes('edit') || lower.includes('patch') || lower.includes('apply')) return 'edit';
  if (lower.includes('create')) return 'write';
  if (lower.includes('read') || lower.includes('view') || lower.includes('list')) return 'read';
  if (lower.includes('grep') || lower.includes('glob')) return 'grep';
  if (lower.includes('search') || lower.includes('find')) return 'search_fs';
  if (lower.includes('web') || lower.includes('fetch') || lower.includes('http')) return 'web_search';
  if (lower.includes('todo')) return 'todo';
  if (lower.includes('task')) return 'task';
  if (lower.includes('lsp')) return 'lsp';
  if (lower.includes('eval')) return 'eval';
  if (lower.includes('github')) return 'github';
  if (lower.includes('security')) return 'security_scan';
  return null;
}

/**
 * The one renderer family for a call.
 *
 * Precedence is load-bearing. A name the host knows always wins, because a
 * plugin may own an unknown name and must still be reachable. `kind` and the
 * substring inference are fallbacks for adapters that send a title instead of
 * a tool name — the case that used to produce `type:"bash"` with no panel.
 */
export function resolveToolRender(input: ToolRenderInput): ToolRender {
  const tool = candidate(input);
  const key = panelKeyFor(tool, input);
  return key === null
    ? { key: 'custom', normalized: false }
    : { key, normalized: true };
}

function panelKeyFor(tool: ToolCallData, input: ToolRenderInput): ToolRenderKey | null {
  if (procPathOf(tool)) return 'proc';
  if (isXdDocRead(tool)) return 'read';

  // omp 19.1.0 runs rarely-used tools as bare bash commands; when the call IS
  // that invocation, the wrapped tool names the panel.
  const sole = soleToolCommand(tool);
  if (sole) {
    if (sole.dispatch.tool.startsWith('mcp__')) return 'mcp';
    const inner = DEVICE_KINDS[sole.dispatch.tool];
    if (inner) return inner;
  }

  const device = xdDevice(tool);
  if (device) {
    if (device.startsWith('mcp__')) return 'mcp';
    const byDevice = DEVICE_KINDS[device];
    if (byDevice) return byDevice;
  }

  // omp also names a device call in the RESULT (`details.xdev.tool`), which is
  // the only place a call whose arguments never carried the URL has one.
  const xdev = isRecord(tool.details) && isRecord(tool.details.xdev)
    ? tool.details.xdev.tool
    : undefined;
  if (typeof xdev === 'string' && xdev) {
    const bare = (xdev.startsWith('xd://') ? xdev.slice('xd://'.length) : xdev)
      .split(/[/?#\s]/)[0].toLowerCase();
    if (bare.startsWith('mcp__')) return 'mcp';
    const byDevice = DEVICE_KINDS[bare];
    if (byDevice) return byDevice;
  }

  const raw = canonicalAgentToolName(input.name || input.type || '').toLowerCase();
  if (raw.startsWith('mcp__')) return 'mcp';
  const known = PANEL_KINDS[LEGACY_TOOL_ALIASES[raw] ?? raw];
  if (known) return known;

  const byKind = KIND_KEYS[input.kind ?? input.rawKind ?? ''];
  if (byKind) return byKind;

  return inferFromText(raw) ?? inferFromText(input.title ?? '') ?? null;
}
