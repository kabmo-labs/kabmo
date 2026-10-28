/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which specialized panel renders a tool call — as DATA, not as a chain of
 * `if`s plus a probe render.
 *
 * The previous shape dispatched by walking 33 aliases and asked whether a tool
 * had a panel by CALLING the renderer and discarding its VNode
 * (`hasToolDetailsPanel` → `ToolDetailsPanel({tool}) !== null`). That probe ran
 * on every render of every card, and because the timeline re-renders a tool on
 * each streaming frame, it built the panel's tree twice per frame for a call
 * that had not finished. It also could not be tested without mounting, and
 * adding a tool meant editing two places.
 *
 * `toolPanelKind` is pure and total; the component map in `index.tsx` is keyed
 * by the same strings, so a new tool is one row here.
 */

import type { ToolCallData } from '@/shared/types/chat';
import { procPathOf } from '@/shared/lib/omp/session/proc';

/** Legacy Kabmo/MOCK alias → canonical omp tool name. */
export const TOOL_ALIASES: Record<string, string> = {
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

/** Panel key. `search_fs` is deliberately distinct from `grep`: the two render
 *  different components (a filesystem item list vs. a match list). */
export type ToolPanelKind =
  | 'read' | 'edit' | 'write' | 'bash' | 'eval' | 'grep' | 'search_fs'
  | 'todo' | 'task' | 'web_search' | 'lsp' | 'ast_edit'
  | 'resolve' | 'reject' | 'proc' | 'github' | 'checkpoint'
  | 'security_scan' | 'debug' | 'manage_skill' | 'context_notes'
  | 'memory_edit' | 'goal' | 'ask' | 'think' | 'mcp' | 'wait';

/** Keys that have a panel — a lookup, not a branch. */
const PANEL_KINDS: Record<string, ToolPanelKind> = {
  read: 'read', edit: 'edit', write: 'write', bash: 'bash', eval: 'eval',
  grep: 'grep', glob: 'grep', search_fs: 'search_fs',
  todo: 'todo', task: 'task', web_search: 'web_search',
  lsp: 'lsp', ast_edit: 'ast_edit', resolve: 'resolve', reject: 'reject',
  // The legacy `hub` tool is omp's own predecessor to `proc://` and carries
  // the same `details` — one panel renders both, so a replayed transcript and
  // a live call cannot draw the process table two different ways.
  hub: 'proc', github: 'github', checkpoint: 'checkpoint',
  security_scan: 'security_scan', debug: 'debug', manage_skill: 'manage_skill',
  context_notes: 'context_notes', memory_edit: 'memory_edit', goal: 'goal',
  ask: 'ask', think: 'think',
  // `wait` blocks on background jobs and services the agent started, and its
  // result is the only place their status and elapsed time exist. It had no
  // panel at all, so a call that can occupy 30 minutes rendered as a title and
  // an empty Output block.
  wait: 'wait',
};

/** Devices whose panel is not named after the device itself. */
const DEVICE_KINDS: Record<string, ToolPanelKind> = {
  ast_grep: 'grep',
  resolve: 'resolve',
  reject: 'reject',
  lsp: 'lsp',
  ast_edit: 'ast_edit',
  debug: 'debug',
};

function inputRecord(tool: ToolCallData): Record<string, unknown> | undefined {
  return tool.input && typeof tool.input === 'object' && tool.input !== null
    ? (tool.input as Record<string, unknown>)
    : undefined;
}

/**
 * The `xd://<device>` an omp virtual-device call targets, if any. A device call
 * arrives as `write xd://lsp` (or an `mcp__<tool>` name), so the device — not
 * the transport `write` — is what names the panel.
 *
 * `details.xdev.tool` carries the device in both spellings (`lsp` and
 * `xd://lsp` were both measured), so the prefix is stripped when present rather
 * than assumed absent.
 */
export function xdDevice(tool: ToolCallData): string | undefined {
  const details = tool.details as Record<string, unknown> | undefined;
  const xdev = details?.xdev;
  if (xdev && typeof xdev === 'object') {
    const name = (xdev as Record<string, unknown>).tool;
    if (typeof name === 'string' && name) {
      const bare = name.startsWith('xd://') ? name.slice('xd://'.length) : name;
      const device = bare.split(/[/?#\s]/)[0].toLowerCase();
      if (device) return device;
    }
  }
  const input = inputRecord(tool);
  const path = typeof input?.path === 'string' ? input.path : tool.target ?? '';
  if (!path.startsWith('xd://')) return undefined;
  return path.slice('xd://'.length).split(/[/?#\s]/)[0].toLowerCase() || undefined;
}

/** The `xd://` path a READ names, if any — the device's documentation URL.
 *
 * omp answers a read of `xd://` (the listing), `xd://<device>` and
 * `xd://<device>/<topic>` with `xdevDocs`, and its own reader draws all three as
 * an ordinary read — `xd://` has no read card there, unlike `proc://` and
 * `cfg://`. Dispatching by device instead sent it to the device's panel:
 * `read xd://lsp` drew the LSP diagnostics card and `read xd://mcp__…` the MCP
 * argument/result card, both over a page of prose. The write transport is the
 * opposite — `write xd://lsp` IS a call and must reach the device's panel.
 *
 * The FULL path is returned, not the device: `xd://eval/browser` is the browser
 * topic of the `eval` device, and `xdDevice` would report only `eval`. */
export function xdDocPath(tool: ToolCallData): string | undefined {
  const raw = (tool.name || tool.type || '').toLowerCase();
  if ((TOOL_ALIASES[raw] ?? raw) !== 'read') return undefined;
  const input = inputRecord(tool);
  const path = typeof input?.path === 'string' ? input.path : tool.target ?? '';
  return path.startsWith('xd://') ? path : undefined;
}

/** True for a read of a `xd://` documentation URL. */
export function isXdDocRead(tool: ToolCallData): boolean {
  return xdDocPath(tool) !== undefined;
}

/**
 * The panel key for a tool call, or null when it has no specialized panel.
 *
 * Order is load-bearing: a `proc://` call names its panel through the URL — the
 * transport is `read`/`write`, and those panels would draw a process as a file
 * — then a `read xd://<device>` is the device's docs rather than a call, then an
 * omp virtual-device call through its device (so `write xd://lsp` is an LSP
 * panel), an MCP call through its `mcp__` name, and only then does the tool's
 * own name decide.
 */
export function toolPanelKind(tool: ToolCallData): ToolPanelKind | null {
  if (procPathOf(tool)) return 'proc';
  if (isXdDocRead(tool)) return 'read';

  const device = xdDevice(tool);
  if (device) {
    if (device.startsWith('mcp__')) return 'mcp';
    const byDevice = DEVICE_KINDS[device];
    if (byDevice) return byDevice;
  }

  const raw = (tool.name || tool.type || '').toLowerCase();
  if (raw.startsWith('mcp__')) return 'mcp';
  return PANEL_KINDS[TOOL_ALIASES[raw] ?? raw] ?? null;
}
