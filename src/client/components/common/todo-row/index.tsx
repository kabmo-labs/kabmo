/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One todo task row, shared by both surfaces that draw a list — the chat
 * timeline's `todo` tool card and the right-panel Todo view.
 *
 * It lives in `common/` because the two surfaces show the same thing: one row
 * per task, with the five-status icon/tone mapping and the blocker note. Two
 * copies of that markup is how a `blocked` task ends up drawn as a plain
 * pending one on one surface and correctly on the other.
 *
 * A task whose content is an init-list entry rather than prose (omp records
 * the shape a model sent under the wrong key — see
 * `@/shared/lib/chat/todo/nested-phase`) is drawn as the phase it names, with
 * that entry's items listed beneath it, instead of as a JSON blob.
 */

import { Ban, CheckCircle2, Circle, Loader2, OctagonAlert } from 'lucide-preact';
import type { TodoItem, TodoStatus } from '@/shared/types/todo';
import { taskNote, todoStatusVisual } from '@/shared/lib/chat/todo/progress';
import { parseNestedPhaseEntry } from '@/shared/lib/chat/todo/nested-phase';

function StatusIcon({ status, className }: { status: TodoStatus; className: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={13} className={className} />;
    case 'in_progress':
      return <Loader2 size={13} className={`${className} animate-spin`} />;
    case 'abandoned':
      return <Ban size={13} className={className} />;
    case 'blocked':
      return <OctagonAlert size={13} className={className} />;
    default:
      return <Circle size={13} className={className} />;
  }
}

export function TodoRow({ task, current }: { task: TodoItem; current: boolean }) {
  const visual = todoStatusVisual(task.status);
  const note = taskNote(task);
  // Two producers reach this row with different data: the chat card's parser
  // has already labelled the content and kept the encoded items in `notes`,
  // while the right-panel view renders omp's snapshot verbatim, where the
  // content is still the raw blob. Parsing the content covers the second, and
  // the stored `notes` the first.
  const nested = parseNestedPhaseEntry(task.content);
  const label = nested ? nested.phase : task.content;
  const items = nested ? nested.items : task.notes;

  return (
    <div
      className={`flex items-start gap-2.5 px-2.5 py-1.5 transition-colors ${
        current ? 'bg-ink/[0.04]' : ''
      }`}
    >
      <StatusIcon status={task.status} className={`mt-[2px] shrink-0 ${visual.tone}`} />
      <div className="min-w-0 flex-1">
        <div
          className={`text-[11.5px] leading-snug ${
            visual.closed
              ? 'text-ink/40 line-through'
              : visual.active
                ? 'font-medium text-ink'
                : 'text-ink/75'
          }`}
        >
          {label}
        </div>
        {items && items.length > 0 && (
          <ul className="mt-0.5 space-y-0.5">
            {items.map((item, i) => (
              <li key={i} className="text-[10.5px] leading-snug text-ink/55 break-words">
                · {item}
              </li>
            ))}
          </ul>
        )}
        {note && (
          <div className="mt-0.5 text-[10.5px] leading-snug text-warning/90 break-words">{note}</div>
        )}
      </div>
      {visual.active && (
        <span className="shrink-0 rounded bg-ink/8 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink/70">
          Now
        </span>
      )}
    </div>
  );
}
