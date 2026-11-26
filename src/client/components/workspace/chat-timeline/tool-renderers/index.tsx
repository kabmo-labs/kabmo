/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The panel registry: a component per `ToolPanelKind`.
 *
 * `toolPanelKind` reads the SERVER's `render` field (pure, in `registry.ts`);
 * this file is only the map from that key to the component. A row the server
 * could not classify resolves to no key, and `ToolBody` draws its JSON
 * fallback instead of a guessed panel.
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
import { hashlineTargetPath } from '@kabmo-labs/kabmo-omp-session-core/hashline-patch';
import { getToolInputPath } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/tool-input';
import { toolPanelKind, type ToolPanelKind } from '@/client/components/workspace/chat-timeline/tool-renderers/registry';

export { resolveToolKey } from '@/client/components/workspace/chat-timeline/tool-renderers/registry';

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
    const fromInput = getToolInputPath(tool.input);
    if (fromInput) return fromInput;
    const patchPath = hashlineTargetPath(tool.input as Record<string, unknown>);
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
 * Panel khusus per tool family — dirender di dalam body setiap render style.
 * Classification is pure (`toolPanelKind`); this only maps the key to a
 * component, so asking "does this tool have a panel?" no longer builds one.
 */
export function ToolDetailsPanel({ tool }: { tool: ToolCallData }): ReactNode {
  const kind = toolPanelKind(tool);
  if (!kind) return null;
  return PANELS[kind]({ tool });
}

