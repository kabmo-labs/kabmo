import { useCallback, useEffect, useRef } from 'preact/hooks';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { useChamberEvent } from '@/client/hooks/ui/window-event';
import { diffTabId, diffTabName, fileTabId } from '@/shared/lib/workspace/file-tab-id';
import { getSessionValue, setSessionKey } from '@/shared/lib/workspace/session-state/store';
import {
  SCROLL_POSITIONS_KEY,
  dropScrollPosition,
  type ScrollPositions,
} from '@/shared/lib/workspace/scroll-positions';
import type { OpenedFile } from '@/shared/types/fs';

export interface OpenFileInput {
  id?: number | string;
  name: string;
  path: string;
  content?: string;
  root?: string;
  repo?: string;
  /** The live handle a PWA launch opened this file through, when there is one. */
  handleId?: string;
}

export function useFileTabs(
  activeProjectPath: string | null,
  sessionId: string,
  onOpenTab?: () => void
) {
  const [openedFiles, setOpenedFiles] = useSessionState<OpenedFile[]>('layout.openedFiles', []);
  const [activeFileId, setActiveFileId] = useSessionState<number | string | null>('layout.activeFileId', null);

  /**
   * Forget the scroll offset of a tab that is going away.
   *
   * Here, at the mutation, and deliberately not in an effect watching
   * `openedFiles`: an effect sees that list at moments that are not user
   * actions — before the session's blob has restored the tabs, and while a
   * workspace switch is mid-flight — and pruning against a transiently empty
   * list deleted every stored position on the way in (measured: the offset
   * persisted, then came back as `{}` after a reload). A closed tab's id is
   * reused when the same file is opened again, so keeping the entry would apply
   * a stale position.
   */
  const dropScrollFor = useCallback(
    (ids: Array<number | string>) => {
      const current = getSessionValue<ScrollPositions>(sessionId, SCROLL_POSITIONS_KEY);
      let next = current;
      for (const id of ids) next = dropScrollPosition(next, String(id));
      if (next !== current) setSessionKey(sessionId, SCROLL_POSITIONS_KEY, next);
    },
    [sessionId],
  );

  const activeRootRef = useRef<string | null | undefined>(undefined);
  const { ready: layoutReady } = useSessionStateContext();
  const wipedRootRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (activeRootRef.current === activeProjectPath) return;
    activeRootRef.current = activeProjectPath;
    if (!layoutReady || wipedRootRef.current === activeProjectPath) return;
    wipedRootRef.current = activeProjectPath;
    // The tabs are dropped, but their scroll offsets deliberately are NOT: this
    // wipe is not a user closing a tab. It fires on every load (the root is null
    // until the folder resolves), so dropping here erased the offset the session
    // blob had just restored — measured: the offset persisted as `900`, and came
    // back as `{}` after a reload. The entry is keyed by the file's path hash, so
    // it is reused when that file is opened again, which is the point.
    setOpenedFiles([]);
    setActiveFileId(null);
  }, [activeProjectPath, sessionId, layoutReady, setOpenedFiles, setActiveFileId]);

  const handleOpenFile = useCallback((file: OpenFileInput) => {
    const fileEntry: OpenedFile = {
      ...file,
      // One id scheme for a path, so a file opened from the explorer, a chat
      // link and a converted diff tab all land on the same tab.
      id: file.id ?? fileTabId(file.path),
      root: file.root ?? activeProjectPath ?? undefined,
    };
    setOpenedFiles(prev => {
      const existing = prev.find(
        f => f.id === fileEntry.id || (!f.isDiff && f.path && fileEntry.path && f.path === fileEntry.path)
      );
      if (existing) {
        setActiveFileId(existing.id);
        return prev;
      }
      return [...prev, fileEntry];
    });
    setActiveFileId(fileEntry.id);
    onOpenTab?.();
  }, [activeProjectPath, onOpenTab, setOpenedFiles, setActiveFileId]);

  const handleOpenDiff = useCallback((diffInfo: {
    file: string;
    staged?: boolean;
    status?: string;
    repo?: string;
    root?: string;
  }) => {
    const rawPath = diffInfo.file.replace(/^\/+/, '');
    const isStaged = Boolean(diffInfo.staged);
    const diffId = diffTabId(rawPath, isStaged);

    const diffEntry: OpenedFile = {
      id: diffId,
      name: diffTabName(rawPath),
      path: rawPath,
      isDiff: true,
      diffStatus: diffInfo.status || 'M',
      diffStaged: isStaged,
      repo: diffInfo.repo || '.',
      root: diffInfo.root ?? activeProjectPath ?? undefined,
    };

    setOpenedFiles(prev => {
      const existing = prev.find(
        f => f.id === diffId || (f.isDiff && f.path === rawPath && f.diffStaged === isStaged)
      );
      if (existing) {
        setActiveFileId(existing.id);
        return prev;
      }
      return [...prev, diffEntry];
    });
    setActiveFileId(diffId);
    onOpenTab?.();
  }, [activeProjectPath, onOpenTab, setOpenedFiles, setActiveFileId]);

  const handleCloseFile = useCallback((id: number | string) => {
    dropScrollFor([id]);
    setOpenedFiles(prev => {
      const next = prev.filter(f => f.id !== id);
      if (activeFileId === id) {
        setActiveFileId(next.length > 0 ? next[next.length - 1].id : null);
      }
      return next;
    });
  }, [activeFileId, dropScrollFor, setOpenedFiles, setActiveFileId]);

  /**
   * Turn a diff tab into the plain editor tab for the same file.
   *
   * The panel used to do this by assigning `activeFile.isDiff = false` on the
   * object it was handed. That object is the one inside `layout.openedFiles`,
   * so the flag was mutated in place: React never saw a change (the array
   * identity was identical), the tab kept rendering the diff until the next
   * unrelated render, and — because the array is what gets persisted — the
   * mutation reached the database. After a reload the "diff" tab came back as
   * a file tab, and re-opening that file's diff found an entry that already
   * matched, so the diff never came back at all.
   *
   * The target id is `fileTabId`, so if that file already has a tab the two
   * entries would share an id and React would render duplicate keys. The diff
   * entry is dropped in that case and the existing tab activated instead — the
   * user asked to see the file, and it is already open.
   */
  const convertDiffToEditor = useCallback((diffId: number | string) => {
    setOpenedFiles(prev => {
      const index = prev.findIndex(f => f.id === diffId);
      if (index === -1) return prev;
      const diff = prev[index];
      const fileId = fileTabId(diff.path);
      const alreadyOpen = prev.find(f => f.id === fileId);

      if (alreadyOpen) {
        setActiveFileId(alreadyOpen.id);
        return prev.filter(f => f.id !== diffId);
      }

      const next = [...prev];
      next[index] = {
        id: fileId,
        name: diff.path.split('/').pop() || diff.name,
        path: diff.path,
        root: diff.root,
        repo: diff.repo,
      };
      setActiveFileId(fileId);
      return next;
    });
    // OUTSIDE the updater: a side effect that runs once per call, not once per
    // updater invocation. The diff tab is gone either way (replaced, or dropped
    // because the file already had a tab), so its offsets go with it.
    dropScrollFor([diffId]);
    onOpenTab?.();
  }, [dropScrollFor, onOpenTab, setOpenedFiles, setActiveFileId]);

  // Global listeners for omp:open-file and omp:open-diff
  useChamberEvent('omp:open-file', (e) => {
    const customEvent = e as CustomEvent<{ path: string; name?: string; id?: number; content?: string; root?: string; repo?: string; handleId?: string }>;
    if (!customEvent.detail || !customEvent.detail.path) return;

    const rawPath = customEvent.detail.path.replace(/^\/+/, '');
    const name = customEvent.detail.name || rawPath.split('/').pop() || 'file';

    handleOpenFile({
      id: customEvent.detail.id || fileTabId(rawPath),
      name,
      path: rawPath,
      content: customEvent.detail.content,
      // A caller that knows its own scope (a preview's relative link) keeps it;
      // otherwise the file belongs to the active project.
      root: customEvent.detail.root,
      repo: customEvent.detail.repo,
      handleId: customEvent.detail.handleId,
    });
  });

  useChamberEvent('omp:open-diff', (e) => {
    const customEvent = e as CustomEvent<{
      file: string;
      staged?: boolean;
      status?: string;
      repo?: string;
      root?: string;
    }>;
    if (!customEvent.detail || !customEvent.detail.file) return;
    handleOpenDiff(customEvent.detail);
  });

  return {
    openedFiles,
    activeFileId,
    setActiveFileId,
    handleOpenFile,
    handleOpenDiff,
    handleCloseFile,
    convertDiffToEditor,
  };
}
