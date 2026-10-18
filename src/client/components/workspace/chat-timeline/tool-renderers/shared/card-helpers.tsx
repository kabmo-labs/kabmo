/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Presentation helpers for a tool call card: the glyph per tool family, the
 * icon and label an `eval` names itself with, and the raw text a card falls
 * back to when it has no specialized panel.
 *
 * Pure and DOM-free — the card used to carry all of this inline, which pushed
 * it past the repo's 350-line ceiling and made the header logic inseparable
 * from the markup.
 */

import type { ReactNode } from 'preact/compat';
import {
  Bell,
  Boxes,
  Brain,
  BrainCircuit,
  Camera,
  Check,
  Code2,
  Cpu,
  FileCode,
  FileText,
  GitPullRequest,
  Globe,
  HelpCircle,
  Hourglass,
  ListTodo,
  Search,
  Server,
  Shield,
  Terminal,
  Wrench,
} from 'lucide-preact';
import type { ToolCallData } from '@/shared/types/chat';
import { languageBrandIcon } from '@/client/components/common/file-icon';
import { tryParseJson } from '@/shared/lib/code/syntax-highlight';

/** Glyph for a tool family. Every alias of one tool shares its glyph, so the
 *  table is keyed by the canonical name where one exists. */
const ICON_BY_KEY: Record<string, ReactNode> = {
  bash: <Terminal size={14} />,
  terminal: <Terminal size={14} />,
  edit: <FileCode size={14} />,
  write: <FileCode size={14} />,
  edit_file: <FileCode size={14} />,
  create_file: <FileCode size={14} />,
  ast_edit: <FileCode size={14} />,
  read: <FileText size={14} />,
  read_file: <FileText size={14} />,
  view_file: <FileText size={14} />,
  glob: <Search size={14} />,
  grep: <Search size={14} />,
  search_fs: <Search size={14} />,
  ast_grep: <Search size={14} />,
  web_search: <Globe size={14} />,
  todo: <ListTodo size={14} />,
  task: <ListTodo size={14} />,
  eval: <Code2 size={14} />,
  lsp: <Cpu size={14} />,
  resolve: <Check size={14} />,
  reject: <Check size={14} />,
  hub: <Server size={14} />,
  proc: <Server size={14} />,
  ask: <HelpCircle size={14} />,
  wait: <Hourglass size={14} />,
  think: <BrainCircuit size={14} />,
  security_scan: <Shield size={14} />,
  checkpoint: <Camera size={14} />,
  rewind: <Camera size={14} />,
  github: <GitPullRequest size={14} />,
  memory_edit: <Brain size={14} />,
  retain: <Brain size={14} />,
  recall: <Brain size={14} />,
  reflect: <Brain size={14} />,
  learn: <Brain size={14} />,
};

export function toolIcon(key: string): ReactNode {
  if (key.startsWith('mcp__')) return <Boxes size={14} />;
  return ICON_BY_KEY[key] ?? <Wrench size={14} />;
}

/** The reminder badge's glyph, so the card does not import an icon for one use. */
export const REMINDER_ICON = <Bell size={10} />;

function inputRecord(tool: ToolCallData): Record<string, unknown> | undefined {
  return tool.input && typeof tool.input === 'object' && tool.input !== null
    ? (tool.input as Record<string, unknown>)
    : undefined;
}

/** `input.title` of an `eval` call — omp's own label for the cell. The card
 *  header names the eval with it rather than the generic tool name. */
export function evalInputTitle(tool: ToolCallData): string | undefined {
  const title = inputRecord(tool)?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : undefined;
}

/** Brand mark for an `eval` call's `language` (`js`, `py`, …); null when the
 *  language is unknown or absent, so the generic code glyph stands in. */
export function evalLanguageIcon(tool: ToolCallData): ReactNode {
  const language = inputRecord(tool)?.language;
  return typeof language === 'string' && language ? languageBrandIcon(language, 14) : null;
}

/** Raw text a card shows when it has no specialized panel: the command, the
 *  arguments, or the path it named. */
export function commandOrInputOf(tool: ToolCallData): string {
  if (tool.command) return tool.command;
  if (typeof tool.input === 'string') return tool.input;
  if (tool.input && typeof tool.input === 'object') return JSON.stringify(tool.input, null, 2);
  if (tool.target || tool.detail) return tool.target || tool.detail || '';
  return '';
}

/** Inner `xd://mcp__<tool>` (or `mcp__<tool>` name) carried by an MCP call.
 *  Returns the bare MCP tool name, e.g. `codegraph_explore`. */
export function mcpToolNameOf(tool: ToolCallData): string | undefined {
  const path = typeof inputRecord(tool)?.path === 'string' ? (inputRecord(tool)!.path as string) : tool.target || '';
  const raw = path.startsWith('xd://')
    ? path.slice(5)
    : typeof tool.name === 'string' && tool.name.startsWith('mcp__')
      ? tool.name
      : '';
  const name = raw.split(/[/?#]/)[0].trim();
  return name.startsWith('mcp__') ? name.slice(5) : undefined;
}

/** Human subject for an MCP call: the intent line wins, else first meaningful
 *  argument (query/pattern/path/…), else nothing. The arguments may arrive as a
 *  JSON string in `content` (the `write xd://mcp__…` transport), which is
 *  parsed so its keys are searchable the same way. */
export function mcpSubjectOf(tool: ToolCallData): string | undefined {
  if (tool.intent) return tool.intent;
  const input = inputRecord(tool);
  if (!input) return undefined;
  const content = typeof input.content === 'string' ? input.content : '';
  const parsed = content ? tryParseJson(content) : null;
  const data = parsed?.isValid && parsed.data && typeof parsed.data === 'object'
    ? (parsed.data as Record<string, unknown>)
    : input;
  const keys = ['query', 'q', 'pattern', 'pat', 'name', 'sql', 'path', 'symbol', 'url', 'command'];
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

/** The diff text a result carries, from `details.diff`/`details.patch` or the
 *  MOCK path's `diff.diffText`. */
export function diffTextOf(tool: ToolCallData): string | undefined {
  if (tool.diff?.diffText) return tool.diff.diffText;
  const details = tool.details;
  if (details && typeof details === 'object') {
    if (typeof details.patch === 'string') return details.patch;
    if (typeof details.diff === 'string') return details.diff;
  }
  return undefined;
}

export interface XdevDetails {
  args?: { action?: string; file?: string; paths?: string[] };
}

/** `details.xdev` of an oh-my-pi virtual device call, if present. */
export function xdevOf(tool: ToolCallData): XdevDetails | undefined {
  const xdev = tool.details?.xdev;
  return xdev && typeof xdev === 'object' ? (xdev as XdevDetails) : undefined;
}
