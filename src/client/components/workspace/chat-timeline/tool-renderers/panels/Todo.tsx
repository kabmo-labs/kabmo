/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The chat timeline's `todo` tool card: what ONE `todo` call did.
 *
 * The body is drawn with the right-panel view's own row component
 * (`@/client/components/common/todo-row`), so a task cannot be a `blocked` row
 * here and a pending one there. Everything this file owns is the card's frame —
 * the progress header and the per-phase groups.
 *
 * The counters come from `todoProgress`, not from the card's own arithmetic:
 * `abandoned` counts as closed and `blocked` does not, which is omp's own rule
 * and the reason a list with a dropped task does not read as permanently stuck.
 */

import { useMemo } from 'preact/hooks';
import { ListTodo } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import type { TodoItem } from '@/shared/types/todo';
import { parseTodoData } from '@/shared/lib/chat/todo/parser';
import { closedTaskCount, todoProgressLabel, todoProgressPercent } from '@/shared/lib/chat/todo/progress';
import { TodoRow } from '@/client/components/common/todo-row';
import { FallbackOutput } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/FallbackOutput';

function PhaseBlock({ name, index, tasks }: { name: string; index: number; tasks: TodoItem[] }) {
  const closed = closedTaskCount({ name, tasks });
  const currentIndex = tasks.findIndex((t) => t.status === 'in_progress');

  return (
    <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper">
      <div className="flex items-center justify-between border-b border-ink/6 bg-canvas/40 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/50">
          {index + 1}. {name}
        </span>
        <span className="font-mono text-[9.5px] text-ink/40">
          {closed}/{tasks.length}
        </span>
      </div>

      <div className="divide-y divide-ink/[0.04] p-1">
        {tasks.map((task, tIdx) => (
          <TodoRow key={`${tIdx}-${task.content}`} task={task} current={tIdx === currentIndex} />
        ))}
      </div>
    </div>
  );
}

export function Todo({ tool }: { tool: ToolCallData }) {
  const { groups, progress, opBadge } = useMemo(() => parseTodoData(tool), [tool]);

  if (groups.length === 0 && !opBadge) {
    const rawOutput = tool.output || '';
    if (!rawOutput.trim()) return null;
    return <FallbackOutput text={rawOutput} />;
  }

  const pct = todoProgressPercent(progress);
  const current = groups.flatMap((g) => g.tasks).find((t) => t.status === 'in_progress');

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-ink/8 bg-paper p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ListTodo size={13} className="text-ink/60" />
            <span className="text-[11px] font-semibold text-ink">Todo</span>
            {opBadge && (
              <span className="rounded bg-success/10 px-2 py-0.5 font-mono text-[9.5px] font-medium text-success">
                {opBadge}
              </span>
            )}
          </div>
          {progress.total > 0 && (
            <div className="flex items-center gap-2 font-mono text-[10.5px]">
              <span className="text-ink/50">
                {progress.closed} of {progress.total} done
              </span>
              <span className="rounded bg-ink/5 px-1.5 py-0.2 font-semibold text-ink">{pct}%</span>
            </div>
          )}
        </div>

        {progress.total > 0 && (
          <div className="mt-2.5 font-mono text-[10px] text-ink/55">{todoProgressLabel(progress)}</div>
        )}

        {progress.total > 0 && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/8">
            <div
              className="h-full rounded-full bg-success transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        {current && <div className="mt-2 truncate text-[10.5px] text-ink/55">Now: {current.content}</div>}
      </div>

      <div className="space-y-2">
        {groups.map((group, gIdx) => (
          <PhaseBlock key={`${gIdx}-${group.name}`} name={group.name} index={gIdx} tasks={group.tasks} />
        ))}
      </div>
    </div>
  );
}
