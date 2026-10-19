import type { ChatMessageData } from '@/shared/types';
import { builtInToolsPart1 } from '@/client/data/samples/sample-tools/built-in-part1';
import { builtInToolsPart2 } from '@/client/data/samples/sample-tools/built-in-part2';
import { otherTools } from '@/client/data/samples/sample-tools/other';

export const SAMPLE_TOOLS_SESSION_ID = '01a084a9-f134-74a6-b5b6-50b0b6816c5f';

export const allSampleTools = [
  ...builtInToolsPart1,
  ...builtInToolsPart2,
  ...otherTools,
];

export const sampleUserPrompt = `call tool all of this

# Tool Calling Types — Kabmo (38)

## Built-in omp (29)
read  bash  edit  write  ast_grep  ast_edit  ask  debug  eval  github
glob  grep  lsp  checkpoint  rewind  context_notes  new_context
security_scan  task  hub  todo  web_search  memory_edit  retain
recall  reflect  learn  manage_skill

## Hidden (3)
think  yield  goal

## Legacy MOCK alias (5)
edit_file  read_file  view_file  create_file  search_fs

## Dinamis (1)
custom  (string & {}) → mcp__`;

export function getSampleToolsSession() {
  const date = 'Sep 8, 10:45 PM';

  const messages: ChatMessageData[] = [
    {
      id: 'msg-sample-user-1',
      role: 'user',
      date,
      content: sampleUserPrompt,
    },
    {
      id: 'msg-sample-ai-1',
      role: 'ai',
      date,
      thinking: {
        duration: '3.4s',
        summary: 'Execute and render all 38 tool calling types across built-in, hidden, legacy, and dynamic categories.',
        thought: `1. Received request to demonstrate all 38 tool calling types supported by Kabmo.
2. Built-in omp tools (29): read, bash, edit, write, ast_grep, ast_edit, ask, debug, eval, github, glob, grep, lsp, checkpoint, rewind, context_notes, new_context, security_scan, task, hub, todo, web_search, memory_edit, retain, recall, reflect, learn, manage_skill.
3. Hidden tools (3): think, yield, goal.
4. Legacy MOCK aliases (5): edit_file, read_file, view_file, create_file, search_fs.
5. Dynamic MCP / Custom (1): mcp__sqlite_query and terminal.
6. Ensuring each renderer mounts into its dedicated readable panel inside ToolCardShell.`,
      },
      toolCalls: allSampleTools,
      content: `I have executed and surfaced all **38 tool calling types** across the workspace. Each tool call is rendered using its dedicated, readable UI panel:

- **Built-in OMP (29)**: File system operations, terminal execution, AST refactoring, LSP diagnostics, GitHub integrations, checkpoints, security audits, subagent tasks, process hub, and memory management.
- **Hidden Tools (3)**: Architectural thinking, thread yields, and goal verification.
- **Legacy MOCK Aliases (5)**: File inspection and editing wrappers.
- **Dynamic Tools (1)**: MCP SQLite queries and external server bridges.

You can inspect each card below to view detailed execution traces, syntax highlighting, diffs, and metrics.`,
      summary: 'All 38 tool calling types successfully executed and displayed in timeline.',
    },
    {
      id: '0eb26c5d',
      role: 'ai',
      date,
      content: '',
      notice:
        '<system-reminder>\n`ast_edit` result above: PREVIEW — no files changed. Finalize now with `write`: write a one-sentence plain-text reason to `xd://resolve` to APPLY, or `xd://reject` to DISCARD.\n</system-reminder>',
    },
  ];

  return {
    id: SAMPLE_TOOLS_SESSION_ID,
    title: 'call tool all of this (38 Tool Types)',
    date,
    model: 'DeepSeek V4 Pro',
    messages,
  };
}
