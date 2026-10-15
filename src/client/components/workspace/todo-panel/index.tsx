/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Right-panel Todo view: the session's live todo list, as oh-my-pi itself
 * would resume with it.
 *
 * The list is omp's, read from the session transcript (see
 * `@/server/lib/omp/session/todos`), so this panel adds presentation only —
 * phase groups, a progress bar, and the current task called out. It deliberately
 * does NOT recompute or cache a list of its own: a chamber-side copy would drift
 * from the one the agent rehydrates, and a plan panel that disagrees with the
 * agent is worse than no panel.
 *
 * Empty states are distinguished, because they mean different things: no
 * session selected, a session whose transcript has no todo snapshot at all
 * (the agent never used the tool here), and a snapshot whose every task is
 * closed.
 */

import { useMemo } from 'preact/hooks';
import { AlertCircle, ListTodo, RefreshCw } from 'lucide-preact';
import { useSearchParams } from '@/client/lib/router/search-params';
import { useSessionState } from '@ompchamber/ui';
import { TodoPhaseGroup } from '@/client/components/workspace/todo-panel/PhaseGroup';
import { currentTaskLocation, todoProgressLabel, todoProgressPercent } from '@/shared/lib/chat/todo/progress';
import { useRealtimeTopic } from '@/client/hooks/ui/realtime';
import { sessionTodosTopic } from '@/shared/lib/realtime/protocol';
import type { SessionTodosPayload } from '@/shared/types/todo';

interface TodoPanelProps {
  className?: string;
  /**
   * False while the view is not the one on screen: releases the session's todos
   * topic.
   *
   * Deliberately NOT the `enabled` gate the workspace-scoped panels take. That
   * flag means "the active session's cwd resolves to a registered workspace
   * folder", which files/search/git/terminal genuinely need. A todo list does
   * not: it lives in the session's own transcript, so a session running outside
   * every registered workspace still has one — gating on the workspace showed
   * "No session selected" for a session that was open and had a full list.
   */
  active?: boolean;
}

export function TodoPanel({ className = '', active = true }: TodoPanelProps) {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('sessionId');
  const [collapsedPhases, setCollapsedPhases] = useSessionState<Record<string, boolean>>(
    'todo.collapsedPhases',
    {},
  );
  // The session's own topic, pushed by the server on every turn boundary —
  // the poll and the event-driven re-read this panel used to hand-roll are
  // both gone.
  const { data, isLoading, refreshing, stale, refresh } = useRealtimeTopic<SessionTodosPayload>(
    sessionId ? sessionTodosTopic(sessionId) : null,
    { enabled: active },
  );

  const snapshot = data?.snapshot ?? null;
  const progress = data?.progress ?? null;

  // `phase:task` of the row to highlight. Derived from the snapshot rather than
  // stored, so it follows the list as it moves.
  const currentKey = useMemo(() => {
    const location = currentTaskLocation(snapshot?.phases ?? []);
    return location ? `${location.phase}:${location.task}` : null;
  }, [snapshot]);

  if (!sessionId) {
    return (
      <div className={`flex h-full flex-col items-center justify-center bg-paper text-ink/40 ${className}`}>
        <span className="text-xs font-mono">No session selected</span>
      </div>
    );
  }

  return (
    <div className={`flex h-full w-full min-w-0 flex-col overflow-hidden bg-paper text-ink ${className}`}>
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-ink/10 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">Todos</h2>
          {snapshot && (
            <span className="truncate font-mono text-[10.5px] text-ink/50" title={todoProgressLabel(progress!)}>
              {todoProgressLabel(progress!)}
            </span>
          )}
          {data?.isMock && (
            <span className="flex-shrink-0 rounded border border-ink/15 bg-ink/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink/60">
              Mock
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={isLoading}
          title="Refresh todos"
          aria-label="Refresh todos"
          className="flex-shrink-0 rounded-md border border-ink/15 bg-paper p-1.5 text-ink/80 transition-colors hover:bg-ink/5 disabled:opacity-50"
        >
          <RefreshCw size={12} className={isLoading || refreshing ? 'animate-spin text-ink' : ''} />
        </button>
      </div>

      {progress && progress.total > 0 && (
        <div className="flex-shrink-0 border-b border-ink/10 px-3.5 py-2.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-ink/8">
            <div
              className="h-full rounded-full bg-success transition-all duration-300"
              style={{ width: `${todoProgressPercent(progress)}%` }}
            />
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto scrollbar-overlay-container p-3.5">
        {stale && (
          <div className="flex items-start gap-2 rounded-lg border border-ink/15 bg-ink/5 px-3 py-2 text-[11px] text-ink/60">
            <AlertCircle size={13} className="mt-[1px] shrink-0" />
            <span className="min-w-0 break-words">Reconnecting — this list may be out of date.</span>
          </div>
        )}

        {!snapshot ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-ink/40">
            <ListTodo size={20} />
            <p className="max-w-[240px] text-[11.5px] leading-relaxed">
              No todo list in this session. The agent writes one with the <span className="font-mono">todo</span> tool
              when a task is worth planning.
            </p>
          </div>
        ) : (
          <>
            {snapshot.phases.map((phase, index) => (
              <TodoPhaseGroup
                key={`${index}-${phase.name}`}
                phase={phase}
                index={index}
                collapsed={Boolean(collapsedPhases[String(index)])}
                currentKey={currentKey}
                onToggle={() =>
                  setCollapsedPhases((prev) => ({ ...prev, [String(index)]: !prev[String(index)] }))
                }
              />
            ))}

            <p className="pt-1 text-[10.5px] leading-relaxed text-ink/35">
              Read from this session&apos;s transcript
              {snapshot.updatedAt ? ` · updated ${formatStamp(snapshot.updatedAt)}` : ''}
              {snapshot.source === 'custom' ? ' · edited by hand' : ''}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Local time of a snapshot stamp; the raw ISO string when it cannot be read. */
function formatStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
