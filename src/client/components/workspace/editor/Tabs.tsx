import { useEffect, useRef, useState } from 'preact/hooks';
import { FileIcon } from '@/client/components/common/file-icon';
import { ChevronDown, GitCompare, X } from 'lucide-preact';
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
}

export function EditorTabs({ openedFiles, activeFileId, onSelectFile, onCloseFile, missingIds }: EditorTabsProps) {
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [maxVisibleTabs, setMaxVisibleTabs] = useState(5);
  const [showDropdown, setShowDropdown] = useState(false);

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
              <div
                className={`p-0.5 rounded hover:bg-ink/10 touch-visible ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseFile(file.id);
                }}
              >
                <X size={12} />
              </div>
            </div>
          );
        })}
      </div>

      {hiddenTabs.length > 0 && (
        <div className="relative flex items-center ml-auto bg-ink/10" ref={dropdownRef}>
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
                    <div
                      className="touch-visible p-0.5 rounded hover:bg-ink/10 opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseFile(file.id);
                        if (hiddenTabs.length === 1) setShowDropdown(false);
                      }}
                    >
                      <X size={12} className="text-ink/60" />
                    </div>
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
