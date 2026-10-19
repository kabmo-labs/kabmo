import type { ToolCallData } from '@/shared/types';

export const builtInToolsPart1: ToolCallData[] = [
  {
    id: 'call_01_read',
    name: 'read',
    type: 'read',
    title: 'read — app/types/chat.ts',
    target: 'app/types/chat.ts',
    input: { path: 'app/types/chat.ts', offset: 1, limit: 15 },
    // The real shape omp 18.10.3 answers a `read` with: a PIPE gutter
    // (`1|code`, not `1:code`) and a `details` bag carrying the size/line facts.
    // The demo used a colon gutter with no details, so it exercised neither the
    // facts path nor the furniture rule — and a colon-gutter read is a shape
    // the product never receives.
    details: { contentType: 'text/plain', totalLines: 13, fileSize: 412 },
    output: `1| export interface Attachment {
2|   id: string;
3|   name?: string;
4|   file: File;
5|   preview: string;
6| }
7|
8| export type ToolType =
9|   | 'bash' | 'read' | 'edit' | 'write'
10|  | 'ast_grep' | 'ast_edit' | 'ask'
11|  | 'debug' | 'eval' | 'github' | 'glob'
12|  | 'grep' | 'lsp' | 'checkpoint' | 'rewind'
13|  | 'context_notes' | 'new_context' | 'security_scan';`,
    status: 'success',
    duration: '18ms',
  },
  {
    id: 'call_01b_read_selector',
    name: 'read',
    type: 'read',
    // The path itself carries omp's read selector (`:23-300:raw`) — the shape a
    // real call uses for a ranged verbatim read. The panel must still pick the
    // language off `.tsx`; reading the extension off the raw string gave
    // `tsx:23-300:raw`, an unknown one, so the surface rendered unhighlighted.
    title: 'read — src/App.tsx:23-300:raw',
    target: 'src/App.tsx:23-300:raw',
    input: { path: 'src/App.tsx:23-300:raw' },
    details: { contentType: 'text/plain', totalLines: 12, fileSize: 388 },
    output: `23| export function App() {
24|   return (
25|     <div className="app">
26|       <Header title="Kabmo" />
27|       <main>
28|         <ChatTimeline sessionId={sessionId} />
29|       </main>
30|     </div>
31|   );
32| }
33|
34| export default App;`,
    status: 'success',
    duration: '14ms',
  },
  {
    id: 'call_02_bash',
    name: 'bash',
    type: 'bash',
    title: 'bash — git log --oneline -5 && git status --short',
    command: 'git log --oneline -5 && git status --short',
    output: `47bc2cf feat(chat): refine tool card headers
9a18cf4 fix(sidebar): adjust icon sizes
8f12cb1 feat(tools): add ask and think panels
3d20a10 chore: verify bundle size
 M app/components/workspace/chat-timeline/ToolCallCard.tsx
 M app/components/workspace/chat-timeline/tool-renderers/index.tsx

Wall time: 0.14 seconds
Exit code: 0`,
    status: 'success',
    duration: '140ms',
  },
  {
    id: 'call_03_edit',
    name: 'edit',
    type: 'edit',
    title: 'edit — app/components/workspace/chat-timeline/ToolCallCard.tsx',
    target: 'app/components/workspace/chat-timeline/ToolCallCard.tsx',
    input: { path: 'app/components/workspace/chat-timeline/ToolCallCard.tsx' },
    diff: {
      file: 'app/components/workspace/chat-timeline/ToolCallCard.tsx',
      added: 12,
      removed: 2,
      diffText: `@@ -106,6 +106,16 @@
-  return <div className="border">Legacy card</div>;
+  return (
+    <ToolCardShell
+      tool={tool}
+      title={tool.title}
+      badge={resolveToolKey(tool)}
+      status={tool.status}
+    >
+      <ToolDetailsPanel tool={tool} />
+    </ToolCardShell>
+  );`,
    },
    output: 'Successfully applied diff to app/components/workspace/chat-timeline/ToolCallCard.tsx (+12, -2)',
    status: 'success',
    duration: '85ms',
  },
  {
    id: 'call_04_write',
    name: 'write',
    type: 'write',
    title: 'write — app/components/workspace/chat-timeline/tool-renderers/Ask.tsx',
    target: 'app/components/workspace/chat-timeline/tool-renderers/Ask.tsx',
    input: {
      path: 'app/components/workspace/chat-timeline/tool-renderers/Ask.tsx',
      content: "import { CheckCircle2, HelpCircle } from 'lucide-preact';\n\nexport function Ask({ tool }) { ... }",
    },
    diff: {
      file: 'app/components/workspace/chat-timeline/tool-renderers/Ask.tsx',
      added: 45,
      removed: 0,
      diffText: `@@ -0,0 +1,45 @@
+import { CheckCircle2, HelpCircle } from 'lucide-preact';
+import type { ToolCallData } from '@/shared/types';
+
+export function Ask({ tool }: { tool: ToolCallData }) {
+  return (
+    <div className="p-3 text-xs bg-paper">
+      <div className="flex items-center gap-2 font-medium">
+        <HelpCircle size={14} className="text-ink/70" />
+        <span>Question</span>
+      </div>
+    </div>
+  );
+}`,
    },
    output: 'Wrote 45 lines (1.6 KB) to app/components/workspace/chat-timeline/tool-renderers/Ask.tsx',
    status: 'success',
    duration: '112ms',
  },
  {
    id: 'call_05_ast_grep',
    name: 'ast_grep',
    type: 'ast_grep',
    title: 'ast_grep — interface ToolCallData { $$$ }',
    input: { pattern: 'interface ToolCallData { $$$ }', lang: 'typescript' },
    output: `Found 1 match in app/types/chat.ts:
Line 68: export interface ToolCallData {
  id: string;
  type: ToolType;
  title: string;
  target?: string;
  status?: ToolStatus;
  output?: string;
}`,
    status: 'success',
    duration: '32ms',
  },
  {
    id: 'call_06_ast_edit',
    name: 'ast_edit',
    type: 'ast_edit',
    title: 'ast_edit — rewrite ToolType union in chat.ts',
    target: 'app/types/chat.ts',
    input: {
      file: 'app/types/chat.ts',
      rule: { pattern: 'export type ToolType = $$$', rewrite: 'export type ToolType = BuiltInOmp | Hidden | Legacy | Custom;' },
    },
    output: 'Transformed 1 AST node in app/types/chat.ts with zero syntax errors.',
    status: 'success',
    duration: '54ms',
  },
  {
    id: 'call_07_ask',
    name: 'ask',
    type: 'ask',
    title: 'ask — Migration Confirmation',
    input: {
      question: 'Should we auto-migrate legacy sessions to JSONL format?',
      options: ['Yes, auto-migrate now', 'Keep SQLite only', 'Decide later'],
      default: 'Yes, auto-migrate now',
    },
    output: 'User selected: "Yes, auto-migrate now"',
    status: 'success',
    duration: '2.1s',
  },
  {
    id: 'call_08_debug',
    name: 'debug',
    type: 'debug',
    title: 'debug — inspect breakpoint at useChatTimeline:245',
    input: {
      breakpoint: 'useChatTimeline.ts:245',
      variables: ['sessionId', 'isGenerating', 'prev.length'],
    },
    output: `Breakpoint hit at useChatTimeline.ts:245
  sessionId = "01a084a9-f134-74a6-b5b6-50b0b6816c5f"
  isGenerating = true
  prev.length = 2
  Thread 1 suspended in tick loop`,
    status: 'success',
    duration: '45ms',
  },
  {
    id: 'call_09_eval',
    name: 'eval',
    type: 'eval',
    title: "eval — browser.open('http://localhost:3000')",
    input: {
      code: "const tab = await browser.open('http://localhost:3000');\nconst title = await tab.title();\nreturn { title, url: tab.url };",
      language: 'js',
      title: 'Open localhost:3000 and read its title',
      timeout: 30,
    },
    output: '{"title": "Kabmo", "url": "http://localhost:3000/", "status": 200, "ready": true}',
    status: 'success',
    duration: '420ms',
  },
  {
    id: 'call_10_github',
    name: 'github',
    type: 'github',
    title: 'github — pr status #42',
    input: { repo: 'canis/kabmo', action: 'pr_status', pr: 42 },
    output: `PR #42: feat(chat): redesign all tool renderers for readability
Branch: feat/tool-renderers-ux
Author: canis
State: Open (Candidate for merge)
Checks: 2/2 successful
  - build: passing (42s)
  - lint & tsc: clean (9s)`,
    status: 'success',
    duration: '380ms',
  },
  {
    id: 'call_11_glob',
    name: 'glob',
    type: 'glob',
    title: 'glob — app/components/**/*Panel.tsx',
    input: { pattern: 'app/components/**/*Panel.tsx' },
    output: `app/components/workspace/chat-timeline/tool-renderers/Ask.tsx
app/components/workspace/chat-timeline/tool-renderers/Bash.tsx
app/components/workspace/chat-timeline/tool-renderers/Edit.tsx
app/components/workspace/chat-timeline/tool-renderers/Eval.tsx
app/components/workspace/chat-timeline/tool-renderers/Hub.tsx
app/components/workspace/chat-timeline/tool-renderers/Read.tsx
app/components/workspace/chat-timeline/tool-renderers/SearchPanel.tsx
app/components/workspace/chat-timeline/tool-renderers/Todo.tsx`,
    status: 'success',
    duration: '22ms',
  },
  {
    id: 'call_12_grep',
    name: 'grep',
    type: 'grep',
    // The real shape: the SCOPE is the subtitle (`grep — app`) and the PATTERN
    // rides `input.pattern` as the subject chip. The demo put the pattern in the
    // title too, so the same string printed as both the subtitle and the chip.
    title: 'grep — app',
    target: 'app',
    input: { pattern: 'export function ToolCallCard', path: 'app' },
    details: { scopePath: 'app', matchCount: 1, fileCount: 1, truncated: false },
    output: `app/components/workspace/chat-timeline/ToolCallCard.tsx:106:export function ToolCallCard({ tool, isOpen, onToggle }: ToolCallCardProps) {`,
    status: 'success',
    duration: '29ms',
  },
  {
    id: 'call_13_lsp',
    name: 'lsp',
    type: 'lsp',
    title: 'lsp — diagnostics app/types/chat.ts',
    input: { action: 'diagnostics', file: 'app/types/chat.ts' },
    output: `Language server diagnostics for app/types/chat.ts:
  0 errors, 0 warnings.
  All 38 tool union types resolve cleanly.`,
    status: 'success',
    duration: '64ms',
  },
  {
    id: 'call_14_checkpoint',
    name: 'checkpoint',
    type: 'checkpoint',
    title: 'checkpoint — create savepoint cp_pre_redesign',
    input: {
      action: 'create',
      name: 'cp_pre_redesign',
      description: 'Snapshot before tool renderers overhaul',
    },
    output: `Created checkpoint cp_9021a at 2026-09-08 22:50:00 UTC
Tree hash: a8f9c1b72e01 (48 files tracked, clean working copy)`,
    status: 'success',
    duration: '78ms',
  },
  {
    id: 'call_15_rewind',
    name: 'rewind',
    type: 'rewind',
    title: 'rewind — verify rollback target cp_pre_redesign',
    input: { action: 'check', checkpoint: 'cp_pre_redesign' },
    output: `Target checkpoint cp_9021a is valid and verified.
0 uncommitted conflicts detected. Safe to roll back if needed.`,
    status: 'success',
    duration: '42ms',
  },
];
