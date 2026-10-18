/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The panel registry: a component per `ToolPanelKind`, and the two helpers the
 * card needs from it.
 *
 * `toolPanelKind` decides the key (pure, in `registry.ts`); this file is the
 * map from that key to the component. Keeping them apart is what lets the
 * classification be unit-tested without mounting a single panel — the old
 * `hasToolDetailsPanel` answered the same question by rendering and discarding.
 */

import type { ReactNode } from 'preact/compat';
import type { ToolCallData } from '@/shared/types';
import { TaskResult } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/TaskResult';
import { Todo } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Todo';
import { Lsp } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Lsp';
import { WebSearch } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/WebSearch';
import { Eval } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Eval';
import { Github } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Github';
import { Checkpoint } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Checkpoint';
import { Bash } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Bash';
import { SearchTool } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/SearchTool';
import { SecurityScan } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/SecurityScan';
import { Proc } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Proc';
import { ContextNotes } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/ContextNotes';
import { Memory } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Memory';
import { Debug } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Debug';
import { Goal } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Goal';
import { AstEdit } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/AstEdit';
import { Resolve } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Resolve';
import { ManageSkill } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/ManageSkill';
import { SearchFs } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/SearchFs';
import { AskPanel } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel';
import { Think } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Think';
import { Read } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Read';
import { Edit } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Edit';
import { Mcp } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Mcp';
import { Wait } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Wait';
import { hashlineTargetPath } from '@/shared/lib/omp/session/hashline-patch';
import { procPathOf } from '@/shared/lib/omp/session/proc';
import { getToolInputPath } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/tool-input';
import { isXdDocRead, toolPanelKind, type ToolPanelKind } from '@/client/components/workspace/chat-timeline/tool-renderers/registry';

/** One panel component per kind. A kind with no entry falls back to generic
 *  Input/Output rendering; the record is total so a missing one is a type error. */
const PANELS: Record<ToolPanelKind, (props: { tool: ToolCallData }) => ReactNode> = {
  read: ({ tool }) => (
    <Read tool={tool} targetFilePath={resolveTargetFile(tool)} output={tool.output || ''} />
  ),
  edit: Edit,
  write: Edit,
  bash: Bash,
  eval: Eval,
  grep: SearchTool,
  search_fs: SearchFs,
  todo: Todo,
  task: TaskResult,
  web_search: WebSearch,
  lsp: Lsp,
  ast_edit: AstEdit,
  resolve: Resolve,
  reject: Resolve,
  proc: Proc,
  github: Github,
  checkpoint: Checkpoint,
  security_scan: SecurityScan,
  debug: Debug,
  manage_skill: ManageSkill,
  context_notes: ContextNotes,
  memory_edit: Memory,
  goal: Goal,
  ask: AskPanel,
  think: Think,
  mcp: Mcp,
  wait: Wait,
};

/** File a tool call targets: explicit `target`, result details, its arguments
 *  (plain path keys or an omp hashline patch header), then the raw input. */
export function resolveTargetFile(tool: ToolCallData): string | undefined {
  if (tool.target) return tool.target;
  if (tool.diff?.file) return tool.diff.file;
  if (tool.input && typeof tool.input === 'object') {
    const obj = tool.input as Record<string, unknown>;
    if (typeof obj.path === 'string') return obj.path;
    if (typeof obj.TargetFile === 'string') return obj.TargetFile;
    if (typeof obj.targetFile === 'string') return obj.targetFile;
    if (typeof obj.FilePath === 'string') return obj.FilePath;
    if (typeof obj.filePath === 'string') return obj.filePath;
    if (typeof obj.AbsolutePath === 'string') return obj.AbsolutePath;
    if (typeof obj.absolutePath === 'string') return obj.absolutePath;
    if (typeof obj.file === 'string') return obj.file;
    const patchPath = hashlineTargetPath(obj);
    if (patchPath) return patchPath;
  }
  if (typeof tool.details?.path === 'string') return tool.details.path;
  if (typeof tool.input === 'string' && (tool.input.includes('.') || tool.input.includes('/'))) {
    return tool.input;
  }
  if (tool.detail && (tool.detail.includes('.') || tool.detail.includes('/'))) {
    return tool.detail;
  }
  return undefined;
}

/**
 * The canonical key for a tool call — omp's own name with the chamber's legacy
 * aliases folded. Used for icon selection and the header's title fallback.
 */
export function resolveToolKey(tool: ToolCallData): string {
  // A `proc://` call is `read`/`write` transport, so the URL is the only thing
  // that names what it did — the tool key drives the glyph and the header.
  if (procPathOf(tool)) return 'proc';
  // `read xd://<device>` is the device's docs: the key is `read`, so the glyph
  // and the header describe a read rather than the device it documents.
  if (isXdDocRead(tool)) return 'read';

  const details = tool.details as Record<string, unknown> | undefined;
  const xdev = details?.xdev;
  if (xdev && typeof xdev === 'object') {
    const name = (xdev as Record<string, unknown>).tool;
    if (typeof name === 'string' && name) return name.toLowerCase();
  }

  const rawTarget = (tool.target || '').toLowerCase();
  const inputPath = getToolInputPath(tool.input)?.toLowerCase() ?? '';
  const xdTarget = rawTarget.startsWith('xd://')
    ? rawTarget.slice(5)
    : inputPath.startsWith('xd://')
      ? inputPath.slice(5)
      : '';
  if (xdTarget) {
    const device = xdTarget.split(/[/?#]/)[0].trim();
    if (device) return device;
  }

  const rawName = (tool.name || '').toLowerCase();
  if (rawName && rawName !== 'tool' && rawName !== 'custom') return rawName;

  const titlePrefix = (tool.title || '').toLowerCase().split(/[\s—\-:]+/)[0]?.trim();
  if (titlePrefix && TOOL_KEY_TITLES[titlePrefix]) return titlePrefix;

  return (tool.type || '').toLowerCase();
}

/** Title prefixes that name a tool when no `name` was sent (MOCK path). */
const TOOL_KEY_TITLES: Record<string, true> = {
  grep: true, glob: true, read: true, write: true, edit: true, bash: true,
  terminal: true, run_command: true, todo: true, eval: true, hub: true,
  proc: true, lsp: true, github: true, task: true, resolve: true, reject: true,
};

/**
 * Panel khusus per tool family — dirender di dalam body ToolCallCard.
 * Classification is pure (`toolPanelKind`); this only maps the key to a
 * component, so asking "does this tool have a panel?" no longer builds one.
 */
export function ToolDetailsPanel({ tool }: { tool: ToolCallData }): ReactNode {
  const kind = toolPanelKind(tool);
  if (!kind) return null;
  return PANELS[kind]({ tool });
}

/** True kalau tool punya panel khusus yang sudah merender input/output sendiri —
 *  ToolCallCard tidak boleh render Input/Output generik lagi (anti dobel). */
export function hasToolDetailsPanel(tool: ToolCallData): boolean {
  return toolPanelKind(tool) !== null;
}
