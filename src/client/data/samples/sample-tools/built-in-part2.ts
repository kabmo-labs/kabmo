import type { ToolCallData } from '@/shared/types';

export const builtInToolsPart2: ToolCallData[] = [
  {
    id: 'call_16_context_notes',
    name: 'context_notes',
    type: 'context_notes',
    title: 'context_notes — append session conventions',
    input: {
      action: 'append',
      note: 'Architecture guidelines: max 350 lines per file, @/ absolute imports, pure theme CSS variables.',
    },
    output: 'Updated session context notes. Registered 3 key workspace guidelines.',
    status: 'success',
    duration: '15ms',
  },
  {
    id: 'call_17_new_context',
    name: 'new_context',
    type: 'new_context',
    title: 'new_context — isolate subtask context',
    input: { scope: 'tool_renderers_redesign', retain_memory: true },
    output: 'Initialized fresh context window with 4 retained memory facts and 0 token baggage.',
    status: 'success',
    duration: '20ms',
  },
  {
    id: 'call_18_security_scan',
    name: 'security_scan',
    type: 'security_scan',
    title: 'security_scan — dependency audit',
    input: { scope: 'all', check_secrets: true },
    output: `Security scan completed:
  Dependencies: 0 vulnerabilities found across 42 packages.
  Secrets scan: 0 leaked keys or credentials detected.
  Status: Clean (passes enterprise policy)`,
    status: 'success',
    duration: '210ms',
  },
  {
    id: 'call_19_task',
    name: 'task',
    type: 'task',
    title: 'task — parallel UI audit worker',
    input: {
      prompt: 'Audit all 38 tool calling types for proper contrast, padding, and readability',
      concurrency: 3,
    },
    output: `Subagents dispatched: 3 parallel workers completed in 1.4s with 0 errors.
  Worker 1: Read, Write, Edit, Bash (passed contrast checks)
  Worker 2: Eval, Hub, Todo, Ask, Think (passed readability checks)
  Worker 3: Lsp, Search, Security, Memory (passed metrics)`,
    status: 'success',
    duration: '1.4s',
  },
  {
    id: 'call_20_hub',
    name: 'hub',
    type: 'hub',
    title: 'hub — start kabmo daemon',
    input: {
      op: 'start',
      name: 'kabmo',
      application: 'bun',
      args: ['run', 'start'],
      env: { MOCK: 'true' },
      ready: { port: 3000, timeout: 30 },
    },
    output: `Started kabmo: ready pid=43148 uptime=997ms restarts=0
Ready log matched: http://localhost:3000`,
    status: 'success',
    duration: '997ms',
    // The real `details` omp sends for a service launch — the panel reads the
    // snapshot, not the prose, so a sample without it renders as a fallback.
    details: {
      op: 'start',
      daemon: {
        name: 'kabmo',
        id: 'ca665717-71fa-42c6-a749-8cecf4f37982',
        state: 'ready',
        pid: 43148,
        createdAt: 1_791_433_388_035,
        startedAt: 1_791_433_388_038,
        readyAt: 1_791_433_388_270,
        restartCount: 0,
        outputBytes: 4500,
        readyMatch: 'listening on',
        persist: false,
        detached: false,
      },
      timedOut: false,
    },
  },
  {
    id: 'call_21_todo',
    name: 'todo',
    type: 'todo',
    title: 'todo — Tool Renderer Overhaul Progress',
    input: {
      op: 'update',
      list: [
        {
          phase: 'Redesign Phase',
          items: [
            'Refactor ToolCallCard',
            'Implement Bash & Todo',
            'Implement Ask & Think',
            'Provide complete 38 tools sample session',
          ],
        },
      ],
    },
    output: `Active phase 1/1 "Redesign Phase" (1/4 done).
  [X] Refactor ToolCallCard
  [ ] Implement Bash & Todo [in_progress]
  [ ] Implement Ask & Think
  [ ] Provide complete 38 tools sample session
Overall: 1/4 done`,
    status: 'success',
    duration: '30ms',
  },
  {
    id: 'call_22_web_search',
    name: 'web_search',
    type: 'web_search',
    title: 'web_search — Bun v1.2.4 native sse response streaming',
    input: { query: 'Bun v1.2.4 native sse response streaming' },
    output: `1. Bun Documentation: Server-Sent Events (SSE) with Bun.serve()
   Direct streaming using native ReadableStream without buffering.
2. RemisJS Edge Runtime Guide: Edge streaming support for Bun v1.2.4.`,
    status: 'success',
    duration: '410ms',
  },
  {
    id: 'call_23_memory_edit',
    name: 'memory_edit',
    type: 'memory_edit',
    title: 'memory_edit — save preferred theme',
    input: {
      action: 'set',
      key: 'preferred_theme',
      value: 'e-ink-monochrome',
    },
    output: 'Stored in persistent agent memory:\n  preferred_theme = "e-ink-monochrome"',
    status: 'success',
    duration: '12ms',
  },
  {
    id: 'call_24_retain',
    name: 'retain',
    type: 'retain',
    title: 'retain — preserve coding standards',
    input: { fact: 'Files must never exceed 350 lines of code per AGENTS.md rule.' },
    output: 'Retained fact in long-term memory buffer (priority: HIGH).',
    status: 'success',
    duration: '18ms',
  },
  {
    id: 'call_25_recall',
    name: 'recall',
    type: 'recall',
    title: 'recall — check design tokens',
    input: { query: 'border color and background css variables' },
    output: `Recalled 2 matches:
  - var(--theme-paper): main container surface
  - var(--theme-ink): foreground text and border token`,
    status: 'success',
    duration: '25ms',
  },
  {
    id: 'call_26_reflect',
    name: 'reflect',
    type: 'reflect',
    title: 'reflect — evaluate renderer performance',
    input: { topic: 'component modularity and re-render efficiency' },
    output: 'Reflection: Splitting large panels into dedicated files under tool-renderers/ eliminated unnecessary layout recalcs and maintained strict 350-line ceilings.',
    status: 'success',
    duration: '35ms',
  },
  {
    id: 'call_27_learn',
    name: 'learn',
    type: 'learn',
    title: 'learn — synthesize edge route pattern',
    input: { pattern: 'RemisJS + Bun EventSource reattachment on browser reload' },
    output: 'Synthesized learned skill: "bun-sse-recovery-pattern" saved into agent skills index.',
    status: 'success',
    duration: '45ms',
  },
  {
    id: 'call_28_manage_skill',
    name: 'manage_skill',
    type: 'manage_skill',
    title: 'manage_skill — enable @omp/remis-edge-routes',
    input: { action: 'enable', skill: '@omp/remis-edge-routes' },
    output: 'Skill @omp/remis-edge-routes v1.4.0 enabled. Registered 6 runtime commands.',
    status: 'success',
    duration: '60ms',
  },
];
