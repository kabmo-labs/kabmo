/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One run in the list.
 *
 * The row is a button because opening it is the only action; the workflow name
 * leads, because a reader scanning a list asks "which workflow" before "which
 * commit". The state is a MARK AND A COLOUR: a red dot and a green dot are the
 * same mark to a reader who cannot tell them apart, which is why the cross and
 * the tick are different characters.
 *
 * `#185` is the run number GitHub shows in its own UI; the attempt suffix appears
 * only when it is not the first, because `#185` and `#185 (2)` are different runs
 * to the person who pressed re-run.
 */

import type { RunRow } from '../protocol';
import { age, stateClass, stateLabel, stateMark } from './format';

interface RowProps {
  run: RunRow;
  onOpen: (run: RunRow) => void;
}

export function RunRowView({ run, onOpen }: RowProps) {
  const attempt = run.attempt > 1 ? ` (${run.attempt})` : '';
  return (
    <button
      type="button"
      data-action-row={run.id}
      onClick={() => onOpen(run)}
      title={`${stateLabel(run.state)} · ${run.status}${run.conclusion ? ` / ${run.conclusion}` : ''}`}
      class="flex w-full flex-col gap-0.5 border-b border-ink/5 px-3 py-2 text-left hover:bg-ink/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
    >
      <span class="flex items-center gap-1.5 text-[12px] text-ink">
        <span class={`w-3 flex-shrink-0 font-mono text-[11px] ${stateClass(run.state)}`} aria-hidden="true">
          {stateMark(run.state)}
        </span>
        <span class="truncate font-medium">{run.name}</span>
        <span class="flex-shrink-0 font-mono text-[10px] text-ink/50">
          #{run.number}
          {attempt}
        </span>
        <span class="ml-auto flex-shrink-0 font-mono text-[10px] text-ink/45">{age(run.updatedAt)}</span>
      </span>
      <span class="truncate pl-[18px] text-[11px] text-ink/60">{run.title}</span>
      <span class="flex items-center gap-1.5 pl-[18px] font-mono text-[10px] text-ink/45">
        <span class="truncate">{run.branch ?? '—'}</span>
        <span>·</span>
        <span>{run.event}</span>
        <span>·</span>
        <span class="truncate">{run.actor}</span>
      </span>
    </button>
  );
}
