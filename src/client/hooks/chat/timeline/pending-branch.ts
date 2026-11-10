/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pending chat's linked session: the parent it runs under, or the source it
 * forks from.
 *
 * It lives in the pending store, not in component state, because the sidebar
 * row and the send path both read it: the row nests under a parent from the
 * first frame, and the first send decides between `/api/sessions/spawn`, a fork,
 * and a top-level spawn. Choosing a linked session also moves the workspace to
 * that session's folder.
 *
 * A URL twin (`?parentSessionId=` / `?forkFrom=` + `?forkAt=`) is folded back
 * into the entry on mount: the store is in memory, and a reload recreates the
 * row from the URL alone.
 */

import { useCallback, useEffect } from 'preact/hooks';
import { patchPendingEntry, usePendingSessions } from '@/client/hooks/chat/omp/pending-sessions';
import { expandSessionBranch } from '@/client/hooks/workspace/expanded-sessions';
import { setHarnessPick } from '@/client/hooks/chat/timeline/session-harness';
import type { SessionHarness } from '@/client/hooks/chat/timeline/session-harness';
import type { SetSearchParams } from '@/client/lib/router/search-params';
import type { WorkspaceFolderData } from '@/shared/types';

export interface PendingBranchViewProps {
  parentSessionId: string | null;
  onParentSessionChange: (sessionId: string | null) => void;
  branchLabel: string;
  branchAllowNone: boolean;
}

export interface PendingBranchComposerProps {
  harness?: string;
  harnessEditable: boolean;
  onSelectHarness?: (next: string) => void;
}

export interface PendingBranch {
  /** The linked session id, under either meaning. */
  parentSessionId: string | null;
  /** The model the linked session runs on, so the composer starts on it. */
  parentModel: { provider: string; modelId: string } | null;
  viewProps: PendingBranchViewProps;
  composerProps: PendingBranchComposerProps;
}

export function usePendingBranch(args: {
  sessionId: string | null;
  folders: WorkspaceFolderData[];
  selectedFolderId: number | null;
  setSelectedFolderId: (id: number | null) => void;
  urlParentId: string | null;
  urlForkFrom: string | null;
  urlForkAt: string | null;
  setSearchParams: SetSearchParams;
  harnessPicker: SessionHarness['picker'];
  pendingHarnessRef: { current: string | null };
}): PendingBranch {
  const {
    sessionId,
    folders,
    selectedFolderId,
    setSelectedFolderId,
    urlParentId,
    urlForkFrom,
    urlForkAt,
    setSearchParams,
    harnessPicker,
    pendingHarnessRef,
  } = args;
  const entries = usePendingSessions();
  const entry = entries.find((candidate) => candidate.id === sessionId);
  const forkSourceId = entry?.forkSourceSessionId ?? urlForkFrom ?? null;
  const isFork = Boolean(forkSourceId);
  const parentSessionId = forkSourceId ?? entry?.parentSessionId ?? urlParentId ?? null;
  const sessionOf = useCallback(
    (id: string) => folders
      .flatMap((folder) => folder.sessions ?? [])
      .find((session) => String(session.id) === id),
    [folders],
  );
  const linked = parentSessionId ? sessionOf(parentSessionId) : undefined;

  // A reload recreates the row from the URL; fold its branch context into the
  // store so the nesting and the SEND path read one value.
  useEffect(() => {
    if (!sessionId || !sessionId.startsWith('new-')) return;
    if (urlForkFrom && !entry?.forkSourceSessionId) {
      patchPendingEntry(sessionId, (current) => ({
        ...current,
        forkSourceSessionId: urlForkFrom,
        ...(urlForkAt ? { forkAnchorEntryId: urlForkAt } : {}),
      }));
      return;
    }
    if (urlParentId && !entry?.parentSessionId) {
      patchPendingEntry(sessionId, (current) => ({ ...current, parentSessionId: urlParentId }));
    }
  }, [sessionId, entry, urlParentId, urlForkFrom, urlForkAt]);

  // The linked session decides the workspace and the agent before the operator
  // touches either control: a child must run in its parent's folder, and a fork
  // keeps the source's provider. This also covers a menu click whose row did
  // not carry those fields.
  useEffect(() => {
    if (!sessionId || !sessionId.startsWith('new-') || !linked) return;
    const folderId = Number(linked.folder_id);
    if (Number.isFinite(folderId) && folderId !== selectedFolderId) setSelectedFolderId(folderId);
    if (!entry?.harness && linked.harness) {
      patchPendingEntry(sessionId, (current) => ({ ...current, harness: linked.harness! }));
      setHarnessPick(sessionId, linked.harness);
    }
  }, [sessionId, linked, entry?.harness, selectedFolderId, setSelectedFolderId]);

  const onParentSessionChange = useCallback(
    (next: string | null) => {
      if (!sessionId || !sessionId.startsWith('new-')) return;
      // Re-picking the same source keeps the anchor; a different source has no
      // such entry, so it branches at that source's tip.
      if (isFork && next === parentSessionId) return;
      const target = next ? sessionOf(next) : undefined;
      patchPendingEntry(sessionId, (current) => ({
        ...current,
        ...(isFork
          ? {
              forkSourceSessionId: next ?? undefined,
              forkAnchorEntryId: undefined,
            }
          : { parentSessionId: next ?? undefined }),
        ...(target?.harness ? { harness: target.harness } : {}),
        ...(target ? { folderId: target.folder_id } : {}),
      }));
      // The pick store is what the composer's tab strip reads; the entry's
      // `harness` is what the sidebar row's mark reads.
      if (next && target?.harness) setHarnessPick(sessionId, target.harness);
      if (next) expandSessionBranch(next);
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (isFork) {
          if (next) {
            params.set('forkFrom', next);
            params.delete('forkAt');
          } else {
            params.delete('forkFrom');
            params.delete('forkAt');
          }
        } else if (next) {
          params.set('parentSessionId', next);
        } else {
          params.delete('parentSessionId');
        }
        return params;
      }, { replace: true });
      if (target) {
        const id = Number(target.folder_id);
        if (Number.isFinite(id)) setSelectedFolderId(id);
      }
      // A pick made for the previous linked session must not override the new
      // one's own agent; the spawn inherits the session now chosen.
      pendingHarnessRef.current = null;
    },
    [
      sessionId,
      isFork,
      parentSessionId,
      sessionOf,
      setSearchParams,
      setSelectedFolderId,
      pendingHarnessRef,
    ],
  );

  // The fork's provider OWNS the history being branched; switching it would
  // ask an agent to fork a transcript it never wrote. A child may switch.
  const composerProps: PendingBranchComposerProps = isFork
    ? {
        ...(harnessPicker.harness ? { harness: harnessPicker.harness } : {}),
        harnessEditable: false,
      }
    : {
        ...harnessPicker,
        onSelectHarness: (next: string) => {
          harnessPicker.onSelectHarness(next);
          if (sessionId) {
            patchPendingEntry(sessionId, (current) => ({ ...current, harness: next }));
          }
        },
      };

  return {
    parentSessionId,
    parentModel: linked?.runModel ?? null,
    viewProps: {
      parentSessionId,
      onParentSessionChange,
      branchLabel: isFork ? 'Fork from' : 'Parent',
      branchAllowNone: !isFork,
    },
    composerProps,
  };
}
