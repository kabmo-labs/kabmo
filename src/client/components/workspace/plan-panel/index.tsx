/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Right-panel Plan: the plan-mode artifacts of the ACTIVE SESSION.
 *
 * This is a WATCHER, not a review surface. Deciding a plan stays where it was —
 * the full-screen review popup the extension raises on `xd://propose` — and this
 * view exists for the time after that: reading what the plan says, and seeing it
 * change when the agent rewrites it (a refine pass, or an approved plan the
 * model keeps editing). The panel therefore re-reads on the same triggers the
 * Todo view does: the session's own `plan` topic, pushed by the server at every
 * turn boundary.
 *
 * Scope is the SESSION, not the workspace. A plan belongs to the conversation
 * that produced it and lives in that session's artifact directory, so this view
 * is reachable for a session running outside every registered workspace — the
 * same exemption the Todos tab takes, and for the same reason.
 *
 * The list is omp's own files (`<slug>-plan.md` under the session's `local/`),
 * read by `@/server/lib/omp/session/plans`. There is no chamber-side copy: a
 * second one would drift from the file the agent is working from.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { AlertCircle, FileText, Loader2, RefreshCw } from 'lucide-preact';
import { useSearchParams } from '@/client/lib/router/search-params';
import { useSessionState } from '@kabmo-labs/ui';
import { PlanNav } from '@/client/components/workspace/plan-panel/Nav';
import { PlanPageView } from '@/client/components/workspace/plan-panel/PageView';
import { useRealtimeTopic } from '@/client/hooks/ui/realtime';
import { sessionPlanTopic } from '@/shared/lib/realtime/protocol';
import type { SessionPlanPayload } from '@/shared/types/plan';

interface PlanPanelProps {
  className?: string;
  /**
   * False while the view is not the one on screen: releases the session's plan
   * topic. The panel stays MOUNTED (the desktop stack hides it with CSS), so its
   * state survives a switch without a re-read.
   */
  active?: boolean;
}

/** The selection, kept next to the session it was made in. */
interface PlanPick {
  sessionId: string;
  path: string;
}

export function PlanPanel({ className = '', active = true }: PlanPanelProps) {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('sessionId');

  // Stored WITH its session: a plan path from another conversation names a file
  // this session does not have, and restoring it would show an empty reader.
  const [pick, setPick] = useSessionState<PlanPick | null>('plan.selectedFile', null);
  const [narrowShowingPage, setNarrowShowingPage] = useState(false);

  const storedPath = pick && pick.sessionId === sessionId ? pick.path : null;
  // The session's own topic. A plan SWITCH is a different session topic — no
  // query to rebuild, because the chosen path is part of the payload the topic
  // already carries (`current`), and the panel picks from it below.
  const plan = useRealtimeTopic<SessionPlanPayload>(
    sessionId ? sessionPlanTopic(sessionId) : null,
    { enabled: active },
  );

  const files = plan.data?.files ?? [];
  const current = plan.data?.current ?? null;
  // The stored plan while it still exists, else whatever the server resolved
  // (what plan mode names, else the newest) — a plan deleted mid-session must
  // not leave the reader pointed at nothing.
  const selectedPath = useMemo(() => {
    if (storedPath && files.some((file) => file.path === storedPath)) return storedPath;
    return current;
  }, [storedPath, files, current]);
  const selectedFile = useMemo(
    () => files.find((file) => file.path === selectedPath) ?? null,
    [files, selectedPath],
  );

  // Persist the resolved selection so a reload reopens the same plan.
  useEffect(() => {
    if (!sessionId || !selectedPath || selectedPath === storedPath) return;
    setPick({ sessionId, path: selectedPath });
  }, [sessionId, selectedPath, storedPath, setPick]);

  // A different session is a different set of plans: drop the narrow-layout
  // drill-down so a session switch lands on the list, not on the old plan.
  useEffect(() => {
    setNarrowShowingPage(false);
  }, [sessionId]);

  const handleSelect = (path: string) => {
    if (sessionId) setPick({ sessionId, path });
    setNarrowShowingPage(true);
  };

  if (!sessionId) {
    return (
      <div className={`flex h-full flex-col items-center justify-center bg-paper text-ink/40 ${className}`}>
        <span className="text-xs font-mono">No session selected</span>
      </div>
    );
  }

  const hasPlan = files.length > 0;

  return (
    <div className={`@container flex h-full min-h-0 w-full flex-col bg-paper text-xs text-ink ${className}`}>
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-ink/10 px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText size={12} className="flex-shrink-0 text-ink/50" />
          <span className="truncate text-[11px] font-medium text-ink/70">Plan mode</span>
          {hasPlan && (
            <span className="flex-shrink-0 rounded border border-ink/15 bg-ink/5 px-1.5 py-0.5 font-mono text-[9.5px] text-ink/60">
              {files.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={plan.refresh}
          disabled={plan.isLoading}
          title="Re-read the plan"
          aria-label="Re-read the plan"
          className="flex-shrink-0 rounded p-1 text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-50"
        >
          <RefreshCw size={13} className={plan.isLoading || plan.refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {plan.stale && !plan.data ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <AlertCircle size={16} className="text-error" />
          <p className="text-error">The plan could not be read.</p>
          <button type="button" onClick={plan.refresh} className="text-[11px] font-semibold text-ink/70 underline underline-offset-2 hover:text-ink">
            Try again
          </button>
        </div>
      ) : !plan.data ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-ink/40">
          <Loader2 size={14} className="animate-spin" />
          <span>Reading the plan…</span>
        </div>
      ) : !hasPlan ? (
        // A distinct empty state, not an error: a session that never entered
        // plan mode has no artifact, and that is the normal case for most chats.
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <FileText size={18} className="text-ink/30" />
          <p className="max-w-sm text-[11px] leading-relaxed text-ink/60">
            No plan yet. Turn on Plan mode in the composer, and the plan this session writes will appear here.
          </p>
        </div>
      ) : (
        // The nav is on the RIGHT (`flex-row-reverse`), mirroring the Wiki
        // panel: the plan keeps the panel's leading edge and the artifact list
        // reads as a menu beside it. The reverse is visual only — DOM order
        // stays list → page, so the narrow drill-down needs no second rule set.
        <div className="flex min-h-0 flex-1 flex-col @[520px]:flex-row-reverse">
          <div
            className={`min-h-0 w-full @[520px]:w-52 @[520px]:flex-shrink-0 border-b border-ink/10 @[520px]:border-b-0 @[520px]:border-l ${
              narrowShowingPage ? 'hidden @[520px]:flex' : 'flex'
            } flex-col`}
          >
            <PlanNav files={files} selected={selectedPath} onSelect={handleSelect} />
          </div>

          <div
            className={`min-w-0 min-h-0 flex-1 ${narrowShowingPage ? 'flex' : 'hidden @[520px]:flex'} flex-col`}
          >
            <PlanPageView
              file={selectedFile}
              content={plan.data.content}
              isLoading={plan.isLoading}
              error={plan.stale ? 'The plan could not be read.' : null}
              truncated={plan.data.truncated}
              onBack={() => setNarrowShowingPage(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
