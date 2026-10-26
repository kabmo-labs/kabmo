import { useEffect, useRef, useState } from 'preact/hooks';
import { FileIcon } from '@/client/components/common/file-icon';
import { ChevronDown, GitCompare, X } from 'lucide-preact';
import { useDirtyTabs } from '@/client/lib/editor-dirty-tabs';
import { TabContextMenu } from '@/client/components/workspace/editor/TabContextMenu';
import { buildTabMenuRows, type TabMenuAction } from '@/client/lib/editor/tab-menu';
import { splitCandidate } from '@/shared/lib/workspace/split-editor';
import { PanelRight } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { getGitStatusInfo } from '@/shared/lib/fs/git-status';
import type { OpenedFile } from '@/shared/types/fs';

interface EditorTabsProps {
  openedFiles: OpenedFile[];
  activeFileId: number | string | null;
  onSelectFile: (id: number | string) => void;
  onCloseFile: (id: number | string) => void;
  /** Tab ids whose file no longer exists on disk (see `useMissingFiles`). */
  missingIds?: ReadonlySet<number | string>;
  /**
   * The tab menu's non-close actions.
   *
   * Kept as callbacks rather than done here: copying a path and revealing a file both
   * need the workspace scope, which the strip does not have.
   */
  onCopyPath?: (tab: OpenedFile) => void;
  onRevealInFiles?: (tab: OpenedFile) => void;
  /** Restore the most recently closed tab; returns false with an empty stack. */
  onReopenClosed?: () => boolean;
  /** How many tabs can still be reopened, so the menu row can be absent when none can. */
  reopenableCount?: () => number;
  /** Split the column to this tab, or change which tab the right pane shows. */
  onSplitTo?: (id: number | string) => void;
  /** Collapse the split. The tabs stay open — a split is a view. */
  onUnsplit?: () => void;
  /** The tab the right pane shows, so `Split right` can be absent for it. */
  splitRightFileId?: number | string | null;
}

export function EditorTabs({
  openedFiles,
  activeFileId,
  onSelectFile,
  onCloseFile,
  missingIds,
  onCopyPath,
  onRevealInFiles,
  onReopenClosed,
  reopenableCount,
  onSplitTo,
  onUnsplit,
  splitRightFileId = null,
}: EditorTabsProps) {
  // Which tabs hold edits that are not on disk. The dot replaces the close `×`
  // while the tab is dirty — the VS Code convention, and the reason it costs no
  // extra column: a second mark beside the × would narrow the name on every tab.
  const dirtyIds = useDirtyTabs();
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [maxVisibleTabs, setMaxVisibleTabs] = useState(5);
  const [showDropdown, setShowDropdown] = useState(false);
  /** The tab the context menu was opened on, with its viewport position. */
  const [menu, setMenu] = useState<{ tab: OpenedFile; x: number; y: number } | null>(null);

  useOnClickOutside(dropdownRef, () => setShowDropdown(false));

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const width = entry.contentRect.width;
        // Average tab width ~ 150px, dropdown button ~ 40px
        const max = Math.max(1, Math.floor((width - 60) / 150));
        setMaxVisibleTabs(max);
      }
    });
    if (tabsContainerRef.current) {
      observer.observe(tabsContainerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  const candidate = splitCandidate(activeFileId, openedFiles.map((file) => file.id));

  let visibleTabs: OpenedFile[] = [];
  let hiddenTabs: OpenedFile[] = [];

  if (openedFiles.length <= maxVisibleTabs) {
    visibleTabs = openedFiles;
  } else {
    const activeIndex = openedFiles.findIndex(f => f.id === activeFileId);
    const visibleSet = new Set<number | string>();

    if (activeIndex !== -1 && activeFileId !== null) {
      visibleSet.add(activeFileId);
    }

    for (let i = openedFiles.length - 1; i >= 0; i--) {
      if (visibleSet.size >= maxVisibleTabs) break;
      visibleSet.add(openedFiles[i].id);
    }

    visibleTabs = openedFiles.filter(f => visibleSet.has(f.id));
    hiddenTabs = openedFiles.filter(f => !visibleSet.has(f.id));
  }

  return (
    <div className="flex bg-ink/10 w-full relative border-b border-ink/10" ref={tabsContainerRef}>
      <div className="flex overflow-hidden">
        {visibleTabs.map(file => {
          const isActive = file.id === activeFileId;
          const isDiff = Boolean(file.isDiff);
          const statusInfo = isDiff ? getGitStatusInfo(file.diffStatus || 'M', file.diffStaged) : null;
          const isMissing = Boolean(missingIds?.has(file.id));

          return (
            <div
              key={file.id}
              onClick={() => onSelectFile(file.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ tab: file, x: event.clientX, y: event.clientY });
              }}
              className={`flex items-center space-x-1.5 px-3 py-1.5 cursor-pointer border-r border-ink/10 min-w-[120px] max-w-[210px] group ${
                isActive ? 'bg-paper border-t-2 border-t-ink text-ink' : 'bg-transparent border-t-2 border-t-transparent text-ink/60 hover:bg-paper/50'
              }`}
              title={isMissing ? `${file.path} — file no longer exists` : file.path}
            >
              {isDiff ? (
                <GitCompare size={14} className={isActive ? 'text-info flex-shrink-0' : 'text-info/70 flex-shrink-0'} />
              ) : (
                <FileIcon name={file.name} size={14} className={`flex-shrink-0${isActive || isMissing ? '' : ' opacity-60'}${isMissing ? ' text-error' : ''}`} />
              )}
              {/* A deleted file keeps its tab (the buffer is still on screen),
                  but the tab must SAY so: the name goes red and struck through,
                  the one convention that reads as "this is gone" at a glance. */}
              <span className={`text-xs font-mono truncate flex-1${isMissing ? ' text-error line-through' : ''}`}>{file.name}</span>
              {statusInfo && (
                <span className={`px-1 text-[9px] font-mono font-bold rounded ${statusInfo.badgeBgClass}`}>
                  {statusInfo.charStatus}
                </span>
              )}
              <TabCloseButton
                dirty={dirtyIds.has(file.id)}
                active={isActive}
                label={`Close ${file.name}`}
                onClose={() => onCloseFile(file.id)}
              />
            </div>
          );
        })}
      </div>

      {menu ? (
        <TabContextMenu
          x={menu.x}
          y={menu.y}
          rows={buildTabMenuRows({
            tab: menu.tab,
            openedFiles,
            dirtyIds,
            reopenable: reopenableCount?.() ?? 0,
            activeFileId,
            splitRightFileId,
          })}
          onAction={(action: TabMenuAction) => {
            const tab = menu.tab;
            switch (action) {
              case 'close':
                onCloseFile(tab.id);
                return;
              case 'close-others':
                // Newest-first so the ACTIVE tab survives as the last one standing:
                // closing others one by one leaves whichever id is not closed, and
                // `onCloseFile` re-targets the active tab on every call.
                for (const file of [...openedFiles].reverse()) {
                  if (file.id !== tab.id) onCloseFile(file.id);
                }
                onSelectFile(tab.id);
                return;
              case 'close-all':
                for (const file of [...openedFiles].reverse()) onCloseFile(file.id);
                return;
              case 'close-saved':
                // The dirty ones stay — the only reading that cannot lose an edit.
                for (const file of [...openedFiles].reverse()) {
                  if (!dirtyIds.has(file.id)) onCloseFile(file.id);
                }
                return;
              case 'copy-path':
                onCopyPath?.(tab);
                return;
              case 'reveal-in-files':
                onRevealInFiles?.(tab);
                return;
              case 'reopen-closed':
                onReopenClosed?.();
                return;
              case 'split-right':
                onSplitTo?.(tab.id);
                return;
              case 'unsplit':
                onUnsplit?.();
                return;
            }
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {/* The split control. It is NOT inside the overflow conditional: the strip folds every
          non-active tab at panel width, so a split reachable only by right-clicking ANOTHER
          tab would be unreachable exactly when the panel is narrow. It splits to the newest
          other tab, which is the one the user just opened. */}
      <div className="ml-auto flex items-center">
        <button
          type="button"
          onClick={() => (splitRightFileId !== null ? onUnsplit?.() : onSplitTo?.(candidate as number | string))}
          disabled={splitRightFileId === null && candidate === null}
          aria-pressed={splitRightFileId !== null}
          aria-label="Split editor"
          title={
            splitRightFileId !== null
              ? 'Close the split pane (the tab stays open)'
              : candidate === null
                ? 'Open another file to split the editor'
                : 'Split the editor and show the newest other file'
          }
          className={`p-1.5 mx-1 rounded transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default ${
            splitRightFileId !== null ? 'bg-ink/10 text-ink' : 'text-ink/60 hover:bg-ink/10'
          }`}
        >
          <PanelRight size={14} />
        </button>
      </div>

      {hiddenTabs.length > 0 && (
        <div className="relative flex items-center bg-ink/10" ref={dropdownRef}>
          <button
            className={`p-1.5 mx-1 rounded hover:bg-ink/10 text-ink/60 ${showDropdown ? 'bg-ink/10 text-ink' : ''}`}
            onClick={() => setShowDropdown(!showDropdown)}
            title="More open files"
          >
            <ChevronDown size={14} />
          </button>

          {showDropdown && (
            <div className="absolute right-0 top-full mt-1 w-52 bg-paper border border-ink/10 rounded shadow-lg z-50 py-1">
              <div className="px-3 py-1 text-[10px] uppercase font-mono text-ink/40 border-b border-ink/10 mb-1">
                Older Tabs
              </div>
              {hiddenTabs.map(file => {
                const isMissing = Boolean(missingIds?.has(file.id));
                return (
                  <div
                    key={file.id}
                    onClick={() => {
                      onSelectFile(file.id);
                      setShowDropdown(false);
                    }}
                    className="flex items-center space-x-2 px-3 py-1.5 hover:bg-ink/5 cursor-pointer group"
                  >
                    {file.isDiff ? (
                      <GitCompare size={14} className="text-info/80" />
                    ) : (
                      <FileIcon name={file.name} size={14} className={isMissing ? 'text-error' : 'opacity-60'} />
                    )}
                    <span className={`text-xs font-mono truncate flex-1 ${isMissing ? 'text-error line-through' : 'text-ink/80'}`}>{file.name}</span>
                    <TabCloseButton
                      dirty={dirtyIds.has(file.id)}
                      active={false}
                      label={`Close ${file.name}`}
                      onClose={() => {
                        onCloseFile(file.id);
                        if (hiddenTabs.length === 1) setShowDropdown(false);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A tab's trailing control: a dot while the tab is dirty, the `×` otherwise.
 *
 * One control, two meanings, because a dirty tab's primary action is still
 * "close" — the dot says what closing would cost, and the pointer reveals the
 * affordance. Two controls side by side would narrow the file name on every tab
 * for a mark most tabs never show.
 *
 * The dot is a `<span>`, not an icon: it is drawn with `rounded-full bg-current`
 * so it inherits the tab's own ink (active vs inactive) with no second colour.
 */
function TabCloseButton({
  dirty,
  active,
  label,
  onClose,
}: {
  dirty: boolean;
  active: boolean;
  label: string;
  onClose: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={label}
      title={dirty ? `${label} — unsaved changes` : label}
      className={`p-0.5 rounded hover:bg-ink/10 touch-visible ${active || dirty ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      onClick={(event) => {
        // The row itself selects the tab; a close must not also open it.
        event.stopPropagation();
        onClose();
      }}
    >
      {dirty ? (
        <span
          className="block w-2 h-2 rounded-full bg-current mx-0.5"
          data-tab-dirty=""
          // The dot is decoration over a control that already names the state in
          // its title and aria-label.
          aria-hidden="true"
        />
      ) : (
        <X size={12} />
      )}
    </div>
  );
}
