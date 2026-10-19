import type { ToolCallData } from '@/shared/types';

export const otherTools: ToolCallData[] = [
  // ── Hidden Tools (3) ──────────────────────────────────────────────────
  {
    id: 'call_29_think',
    name: 'think',
    type: 'think',
    title: 'think — Deep Architectural Reasoning',
    input: {
      thought: `### Architecture & Execution Plan
1. Render all 38 tools with high-readability sub-panels.
2. Comply with AGENTS.md rules: strict 350-line file ceiling, @/ path aliases.
3. Provide immediate access to this sample session via both sidebar and direct URL.`,
    },
    output: 'Reasoning verified: clean layouts, high contrast, zero unused parameters.',
    status: 'success',
    duration: '820ms',
  },
  {
    id: 'call_30_yield',
    name: 'yield',
    type: 'yield',
    title: 'yield — yield thread to IO event loop',
    input: { reason: 'Drain SSE stream buffer on port 3000' },
    output: 'Thread yielded for 10ms. Buffer drained cleanly.',
    status: 'success',
    duration: '10ms',
  },
  {
    id: 'call_31_goal',
    name: 'goal',
    type: 'goal',
    title: 'goal — Complete 38 Tool Calling Types Showcase',
    input: {
      goal: 'Showcase every tool calling type with pristine, readable UX',
      target_completion: '100%',
    },
    output: 'Status: 100% complete. All 38 tool calling types rendered and verified.',
    status: 'success',
    duration: '15ms',
  },

  // ── Legacy MOCK Aliases (5) ───────────────────────────────────────────
  {
    id: 'call_32_edit_file',
    name: 'edit_file',
    type: 'edit_file',
    title: 'edit_file — app/tailwind.css',
    target: 'app/tailwind.css',
    diff: {
      file: 'app/tailwind.css',
      added: 6,
      removed: 1,
      diffText: `@@ -42,1 +42,6 @@
-  --theme-paper: #ffffff;
+  --theme-paper: #faf8f3;
+  --theme-ink: #141310;
+  --theme-error: #b91c1c;`,
    },
    output: 'Successfully applied diff to app/tailwind.css (+6, -1 lines)',
    status: 'success',
    duration: '95ms',
  },
  {
    id: 'call_33_read_file',
    name: 'read_file',
    type: 'read_file',
    title: 'read_file — package.json',
    target: 'package.json',
    output: `{
  "name": "kabmo",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/server/index.ts",
    "build": "bun run scripts/build-client.ts"
  }
}`,
    status: 'success',
    duration: '16ms',
  },
  {
    id: 'call_34_view_file',
    name: 'view_file',
    type: 'view_file',
    title: 'view_file — app/mock.server.ts',
    target: 'app/mock.server.ts',
    output: `1: export function isMockMode(): boolean {
2:   const envVal = (Bun.env.MOCK || "").trim().toLowerCase();
3:   return envVal === "true" || envVal === "1" || envVal === "on" || envVal === "yes";
4: }`,
    status: 'success',
    duration: '14ms',
  },
  {
    id: 'call_35_create_file',
    name: 'create_file',
    type: 'create_file',
    title: 'create_file — app/types/custom.ts',
    target: 'app/types/custom.ts',
    diff: {
      file: 'app/types/custom.ts',
      added: 8,
      removed: 0,
      diffText: `@@ -0,0 +1,8 @@
+export interface CustomPluginConfig {
+  enabled: boolean;
+  endpoint: string;
+}`,
    },
    output: 'Created app/types/custom.ts (8 lines)',
    status: 'success',
    duration: '80ms',
  },
  {
    id: 'call_36_search_fs',
    name: 'search_fs',
    type: 'search_fs',
    title: 'search_fs — find panel components',
    input: { query: 'Panel.tsx' },
    output: `Found 12 matches in app/components/:
  - workspace/chat-timeline/tool-renderers/Bash.tsx
  - workspace/chat-timeline/tool-renderers/Todo.tsx
  - workspace/chat-timeline/tool-renderers/Ask.tsx
  - workspace/chat-timeline/tool-renderers/Think.tsx`,
    status: 'success',
    duration: '28ms',
  },

  // ── Dynamic & Terminal Tools (2) ──────────────────────────────────────
  {
    id: 'call_37_mcp',
    name: 'mcp__sqlite_query',
    type: 'custom',
    title: 'mcp__sqlite_query — SELECT count(*) FROM sessions',
    input: {
      server: 'sqlite-mcp',
      tool: 'query',
      sql: 'SELECT count(*) as total_sessions FROM sessions',
    },
    output: `[{"total_sessions": 24}]
Query executed successfully in 4.2ms.`,
    status: 'success',
    duration: '45ms',
  },
  {
    id: 'call_38_terminal',
    name: 'terminal',
    type: 'terminal',
    title: 'terminal — bun run test --coverage',
    command: 'bun run test --coverage',
    output: `Pass: 42 / 42 tests passing (100%)
Statements: 98.4%
Branches: 94.2%
Functions: 97.6%
Lines: 98.1%
Time: 620ms`,
    status: 'success',
    duration: '620ms',
  },
];
