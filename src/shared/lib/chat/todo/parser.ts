/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Renderer-side parser for one `todo` tool call: reads the human-readable
 * checklist omp returns as the tool's text output (and the `list` argument as a
 * fallback) into phase groups for the chat timeline's tool card.
 *
 * This is NOT the authoritative list — a tool card shows what that ONE call
 * did, while the session's live list is the deepest committed snapshot on the
 * active branch (`./snapshot.ts`, surfaced by the right-panel Todo view). The
 * two must not be merged: a card that displayed the session-wide list would
 * attribute every other call's work to this one.
 *
 * Two shapes the summary can carry are handled here rather than in the card:
 *
 *   - The status vocabulary is omp's own FIVE, not the three the card used to
 *     know. `blocked` and `abandoned` are real (measured in the author's
 *     sessions: 21 results mention a dropped task, 2 a blocked one), and a
 *     parser that only understood three drew both as plain pending.
 *   - A task whose content is an init-list entry rather than prose is recorded
 *     that way by omp itself (see `./nested-phase`), so it is labelled by the
 *     phase it names instead of being rendered as a JSON blob.
 */

import type { ToolCallData } from '@/shared/types';
import type { TodoItem, TodoPhase, TodoProgress, TodoStatus } from '@/shared/types/todo';
import { todoProgress } from '@/shared/lib/chat/todo/snapshot';
import { parseNestedPhaseEntry, stripTrailingStatusNote } from '@/shared/lib/chat/todo/nested-phase';

export interface TodoDataSummary {
  groups: TodoPhase[];
  progress: TodoProgress;
  opBadge?: string;
}

/** Status ranking for the dedup pass — a task seen in two groups keeps the most advanced. */
const STATUS_RANK: Record<TodoStatus, number> = {
  pending: 0,
  blocked: 1,
  in_progress: 2,
  abandoned: 3,
  completed: 4,
};

/**
 * The status annotation omp's summary appends to a task line, in the order it
 * can appear. `blocked` carries the reason, which becomes the task's blocker
 * note — the only place the transcript records WHY a task waits.
 */
function statusFromAnnotation(annotation: string | undefined): { status: TodoStatus; blocker?: string } {
  if (!annotation) return { status: 'pending' };
  const lower = annotation.toLowerCase();
  if (lower === 'completed' || lower === 'done') return { status: 'completed' };
  if (lower === 'in_progress' || lower === 'in progress') return { status: 'in_progress' };
  if (lower === 'abandoned' || lower === 'dropped') return { status: 'abandoned' };
  if (lower === 'blocked') return { status: 'blocked' };
  if (lower.startsWith('blocked')) {
    const reason = annotation.replace(/^blocked\s*:?\s*/i, '').trim();
    return { status: 'blocked', ...(reason ? { blocker: reason } : {}) };
  }
  return { status: 'pending' };
}

/** The status + blocker a checklist line's own annotation encodes. */
function statusFromChecklistText(text: string): { status: TodoStatus; blocker?: string } {
  const inProgress = text.match(/\(in progress\)|\[in_progress\]/i);
  if (inProgress) return { status: 'in_progress' };
  const dropped = text.match(/\((?:dropped|abandoned)\)/i);
  if (dropped) return { status: 'abandoned' };
  const blocked = text.match(/\(blocked(?::\s*([^)]*))?\)/i);
  if (blocked) {
    const reason = blocked[1]?.trim();
    return { status: 'blocked', ...(reason ? { blocker: reason } : {}) };
  }
  return { status: 'pending' };
}

/**
 * One parsed task. `content` is the task text — or, when the content encoded an
 * init-list entry, the PHASE it named, with that entry's items kept as `notes`
 * so nothing is lost and no per-item status is invented.
 */
function buildTask(rawContent: string, status: TodoStatus, blocker?: string): TodoItem {
  const clean = stripTrailingStatusNote(rawContent);
  const nested = parseNestedPhaseEntry(clean);
  return {
    content: nested ? nested.phase : clean,
    status,
    ...(nested ? { notes: nested.items } : {}),
    ...(blocker ? { blocker } : {}),
  };
}

function cleanPhaseName(raw: string): string {
  let name = raw.replace(/:$/, '').trim();
  // Strip "Active phase 1/1" or "Active phase" or "Phase 1:" prefix
  name = name.replace(/^active\s+phase(?:\s+\d+\/\d+)?(?:\s*[:\-]\s*|\s+)?/i, '');
  // Strip quotes around phase name: "Coverage" -> Coverage
  name = name.replace(/^["']|["']$/g, '');
  // Strip trailing parentheticals like (0/4 done) or (4 tasks) or (Coverage)
  name = name.replace(/\s*\(\d+(?:\/\d+)?\s*(?:done|remaining|tasks)?\)$/i, '');
  // If wrapped in parentheses like (Coverage)
  name = name.replace(/^\((.+)\)$/, '$1');
  return name.trim() || 'Tasks';
}

function mergePhaseGroups(rawGroups: TodoPhase[]): TodoPhase[] {
  const map = new Map<string, TodoPhase>();

  for (const g of rawGroups) {
    if (!g.tasks.length) continue;
    const phaseName = cleanPhaseName(g.name);
    const key = phaseName.toLowerCase();

    const existing = map.get(key);
    if (!existing) {
      map.set(key, { name: phaseName, tasks: [...g.tasks] });
      continue;
    }

    // Use the larger group as the base list order
    const baseTasks = g.tasks.length >= existing.tasks.length ? g.tasks : existing.tasks;
    const otherTasks = baseTasks === g.tasks ? existing.tasks : g.tasks;

    const taskMap = new Map<string, TodoItem>();
    for (const t of baseTasks) {
      taskMap.set(t.content.toLowerCase().trim(), { ...t });
    }
    for (const t of otherTasks) {
      const tKey = t.content.toLowerCase().trim();
      const prev = taskMap.get(tKey);
      if (!prev) taskMap.set(tKey, { ...t });
      else if (STATUS_RANK[t.status] > STATUS_RANK[prev.status]) prev.status = t.status;
    }

    existing.name = phaseName;
    existing.tasks = Array.from(taskMap.values());
  }

  const groupsList = Array.from(map.values());
  const result: TodoPhase[] = [];

  for (let i = 0; i < groupsList.length; i++) {
    const gA = groupsList[i];
    const aTexts = gA.tasks.map((t) => t.content.toLowerCase().trim());

    let isSubset = false;
    for (let j = 0; j < groupsList.length; j++) {
      if (i === j) continue;
      const gB = groupsList[j];
      const bTexts = new Set(gB.tasks.map((t) => t.content.toLowerCase().trim()));

      if (gB.tasks.length >= gA.tasks.length && aTexts.every((txt) => bTexts.has(txt))) {
        for (const tA of gA.tasks) {
          const tB = gB.tasks.find((t) => t.content.toLowerCase().trim() === tA.content.toLowerCase().trim());
          if (tB && STATUS_RANK[tA.status] > STATUS_RANK[tB.status]) tB.status = tA.status;
        }
        isSubset = true;
        break;
      }
    }

    if (!isSubset) result.push(gA);
  }

  return result;
}

export function parseTodoData(tool: ToolCallData): TodoDataSummary {
  const input = tool.input;
  const inputObj = typeof input === 'object' && input !== null ? (input as Record<string, any>) : undefined;
  const output = tool.output || '';

  let opBadge: string | undefined;
  let doneRaw: string | undefined;
  if (inputObj?.op === 'done' && inputObj.task) {
    doneRaw = String(inputObj.task);
    opBadge = `Completed: ${parseNestedPhaseEntry(stripTrailingStatusNote(doneRaw))?.phase ?? doneRaw}`;
  } else if (inputObj?.op === 'init') {
    opBadge = 'Initialized Todo List';
  }

  const lines = output.split(/\r?\n/);
  const rawGroups: TodoPhase[] = [];
  let currentGroup: TodoPhase = { name: 'Tasks', tasks: [] };
  let inChecklistSection = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Detect section start: "Active phase ...", "Coverage:", etc.
    if (trimmed.endsWith(':') && !trimmed.startsWith('Overall') && !trimmed.startsWith('Remaining')) {
      const phaseName = cleanPhaseName(trimmed);
      if (currentGroup.tasks.length > 0) rawGroups.push(currentGroup);
      currentGroup = { name: phaseName, tasks: [] };
      inChecklistSection = true;
      continue;
    }

    // Detect checklist items: - [X] or [X] or - [ ] or [ ] or * [X]
    const checkMatch = trimmed.match(/^(?:[-*]\s*)?\[([ xX])\]\s*(.+)$/);
    if (checkMatch) {
      const mark = checkMatch[1].toLowerCase();
      const text = checkMatch[2].trim();
      const annotated = statusFromChecklistText(text);
      const status: TodoStatus = mark === 'x' ? 'completed' : annotated.status;
      currentGroup.tasks.push(buildTask(text, status, annotated.blocker));
      continue;
    }

    // Fallback: parse lines like "  - Add Think renderer [in_progress] (Coverage)"
    const itemMatch = trimmed.match(
      /^-\s*(.+?)\s*\[(in_progress|pending|completed|abandoned|blocked|done)\](?:\s*\((.+?)\))?$/,
    );
    if (itemMatch && !inChecklistSection) {
      const text = itemMatch[1].trim();
      const { status, blocker } = statusFromAnnotation(itemMatch[2]);
      const phase = cleanPhaseName(itemMatch[3]?.trim() || 'Tasks');

      let targetGrp = rawGroups.find((g) => cleanPhaseName(g.name).toLowerCase() === phase.toLowerCase());
      if (!targetGrp) {
        targetGrp = { name: phase, tasks: [] };
        rawGroups.push(targetGrp);
      }
      targetGrp.tasks.push(buildTask(text, status, blocker));
    }
  }

  if (currentGroup.tasks.length > 0 && !rawGroups.includes(currentGroup)) {
    rawGroups.push(currentGroup);
  }

  // If nothing parsed from output, check input.list
  if (rawGroups.length === 0 && Array.isArray(inputObj?.list)) {
    for (const p of inputObj.list) {
      const phaseName = cleanPhaseName(p.phase || 'Tasks');
      const tasks: TodoItem[] = (p.items || []).map((it: string) => ({ content: it, status: 'pending' as const }));
      rawGroups.push({ name: phaseName, tasks });
    }
  }

  // Merge & deduplicate all phase groups
  const groups = mergePhaseGroups(rawGroups);

  // If tool was an op: 'done', ensure the task is marked as done
  if (doneRaw !== undefined) {
    const doneLabel = parseNestedPhaseEntry(stripTrailingStatusNote(doneRaw))?.phase ?? doneRaw;
    const doneText = doneLabel.toLowerCase().trim();
    for (const g of groups) {
      const target = g.tasks.find((t) => t.content.toLowerCase().trim() === doneText);
      if (target) target.status = 'completed';
    }
  }

  const progress = todoProgress(groups);

  return { groups, progress, opBadge };
}
