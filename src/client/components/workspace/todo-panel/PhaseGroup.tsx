/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One phase group of the todo panel: a header with the phase's own `closed/total`
 * badge, then its task rows.
 *
 * The collapse state is the panel's (persisted per session), not local: a list
 * the operator collapsed should stay collapsed across a reload, and the panel
 * owns every phase's flag in one map so "collapse all" is one write.
 */

import { ChevronDown, ChevronRight } from 'lucide-preact';
import type { TodoPhase } from '@/shared/types/todo';
import { closedTaskCount } from '@/shared/lib/chat/todo/progress';
import { TodoRow } from '@/client/components/common/todo-row';

interface TodoPhaseGroupProps {
  phase: TodoPhase;
  index: number;
  collapsed: boolean;
  /** `phase:task` of the row to highlight as current, or null. */
  currentKey: string | null;
  onToggle: () => void;
}

export function TodoPhaseGroup({ phase, index, collapsed, currentKey, onToggle }: TodoPhaseGroupProps) {
  const closed = closedTaskCount(phase);
  const isComplete = phase.tasks.length > 0 && closed === phase.tasks.length;

  return (
    <div className="overflow-hidden rounded-lg border border-ink/10 bg-paper">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1.5 border-b border-ink/8 bg-canvas/40 px-2.5 py-1.5 text-left hover:bg-ink/5"
      >
        {collapsed ? (
          <ChevronRight size={12} className="shrink-0 text-ink/40" />
        ) : (
          <ChevronDown size={12} className="shrink-0 text-ink/40" />
        )}
        <span
          className={`min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wider ${
            isComplete ? 'text-ink/35' : 'text-ink/60'
          }`}
          title={phase.name}
        >
          {index + 1}. {phase.name}
        </span>
        <span className="shrink-0 font-mono text-[9.5px] text-ink/40">
          {closed}/{phase.tasks.length}
        </span>
      </button>

      {!collapsed && (
        <div className="divide-y divide-ink/[0.05] p-0.5">
          {phase.tasks.length === 0 ? (
            <div className="px-2.5 py-1.5 text-[11px] text-ink/40">No tasks in this phase</div>
          ) : (
            phase.tasks.map((task, taskIndex) => (
              <TodoRow
                key={`${taskIndex}-${task.content}`}
                task={task}
                current={currentKey === `${index}:${taskIndex}`}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
