/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deterministic demo payloads for the per-session DATA topics under MOCK=true.
 *
 * Extracted from the `session-todos` / `session-plan` HTTP routes so the
 * realtime `todos` / `plan` topic resolvers share them: the panels read those
 * topics, not the routes, so a demo living only in a route would leave the
 * view empty under MOCK while the API answered — the exact split this module
 * removes. The wiki panel keeps its own demo for the same reason
 * (`@/server/lib/wiki/payload.server`).
 */

import { todoProgress } from '@/shared/lib/chat/todo/snapshot';
import type { SessionTodoState, TodoPhase } from '@/shared/types/todo';
import type { SessionPlanState } from '@/shared/types/plan';

/** Demo list: one phase of every status the todo panel must draw. */
const MOCK_TODO_PHASES: TodoPhase[] = [
  {
    name: 'Server data',
    tasks: [
      { content: 'Read the session transcript for the deepest todo snapshot', status: 'completed' },
      { content: 'Publish the list on the session topic', status: 'in_progress' },
      { content: 'Cache the parse by size + mtime', status: 'pending' },
      { content: 'Republish on the turn-boundary signal', status: 'blocked', blocker: 'waiting on the fold' },
    ],
  },
  {
    name: 'Panel',
    tasks: [
      { content: 'Draw phase groups with per-status glyphs', status: 'pending' },
      { content: 'Collapse closed tasks behind a toggle', status: 'abandoned' },
    ],
  },
];

/** The MOCK todo state, shaped exactly as the panel's topic payload. */
export function mockSessionTodos(): SessionTodoState {
  return {
    snapshot: {
      phases: MOCK_TODO_PHASES,
      sourceEntryId: 'mock-entry',
      source: 'toolResult',
      updatedAt: new Date().toISOString(),
      op: 'start',
      storage: 'session',
    },
    progress: todoProgress(MOCK_TODO_PHASES),
  };
}

/** Demo plan body: a real markdown plan so the renderer is exercised. */
const MOCK_PLAN_MD = `# Add a plan panel

## Context

Kabmo has no view of the plan an omp session is working from. The review
popup covers the moment of approval, and nothing covers what the plan says
afterwards — including the case where the agent rewrites it.

## Approach

- Read the session's \`local/\` artifact directory (omp's own plan root).
- List every \`<slug>-plan.md\`, newest first, and serve the chosen one.
- Take the transcript's \`mode_change\` plan path as the default when present.

## Verification

Open the Plan panel on a session in plan mode and confirm the listed artifacts
match what the agent wrote. Both must agree; then done.
`;

/** The MOCK plan state: a current plan and an older one beside it. */
export function mockSessionPlans(): SessionPlanState {
  return {
    files: [
      { path: 'local://plan-panel-plan.md', title: 'plan-panel', modifiedAt: 0, bytes: MOCK_PLAN_MD.length },
      { path: 'local://plan-panel-v1-plan.md', title: 'plan-panel-v1', modifiedAt: 0, bytes: 412 },
    ],
    current: 'local://plan-panel-plan.md',
    content: MOCK_PLAN_MD,
    truncated: false,
  };
}
