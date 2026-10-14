import { Archive, Calendar, FolderPlus, MoreHorizontal, PanelLeftClose, RefreshCw, Search, X } from 'lucide-preact';
import type { SessionSortOption } from '@/shared/types';
import { SortMenu } from '@/client/components/common/sort-menu';

interface SessionSidebarToolbarProps {
  isSearchVisible: boolean;
  searchQuery: string;
  showArchived: boolean;
  optionsOpen: boolean;
  sortOption: SessionSortOption;
  onToggleSearch: () => void;
  onSearchChange: (value: string) => void;
  onToggleArchived: () => void;
  onHideArchived: () => void;
  onToggleOptions: () => void;
  onCloseOptions: () => void;
  onSortChange: (opt: SessionSortOption) => void;
  onNewWorkspace: () => void;
  onScheduler: () => void;
  /** Armed scheduled tasks, for the Calendar button's badge. */
  scheduledCount: number;
  onRefresh: () => void;
  /** True while the user-initiated refresh is in flight — spins the icon. */
  refreshing: boolean;
  onClose?: () => void;
}

export function SessionSidebarToolbar({
  isSearchVisible,
  searchQuery,
  showArchived,
  optionsOpen,
  sortOption,
  onToggleSearch,
  onSearchChange,
  onToggleArchived,
  onHideArchived,
  onToggleOptions,
  onCloseOptions,
  onSortChange,
  onNewWorkspace,
  onScheduler,
  scheduledCount,
  onRefresh,
  refreshing,
  onClose,
}: SessionSidebarToolbarProps) {
  return (
    <div className="p-3 border-b border-ink/10 flex flex-col space-y-3">
      <div className="flex items-center justify-between px-1 text-ink/60">
        <div className="flex space-x-3 items-center">
          <button
            type="button"
            title="New Workspace"
            aria-label="New Workspace"
            onClick={onNewWorkspace}
            className="inline-flex cursor-pointer bg-transparent border-0 p-0 text-ink/60 hover:text-ink transition-colors"
          >
            <FolderPlus size={14} />
          </button>
          <button
            type="button"
            title={scheduledCount > 0 ? `Scheduled tasks (${scheduledCount} armed)` : 'Scheduled tasks'}
            aria-label={scheduledCount > 0 ? `Scheduled tasks, ${scheduledCount} armed` : 'Scheduled tasks'}
            onClick={onScheduler}
            className="relative inline-flex cursor-pointer bg-transparent border-0 p-0 text-ink/60 hover:text-ink transition-colors"
          >
            <Calendar size={14} />
            {scheduledCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[10px] h-[10px] px-[2px] rounded-full bg-ink text-canvas text-[7px] leading-[10px] text-center font-semibold">
                {scheduledCount > 9 ? '9+' : scheduledCount}
              </span>
            )}
          </button>
          <button
            type="button"
            title="Refresh sessions"
            onClick={onRefresh}
            className="inline-flex cursor-pointer bg-transparent border-0 p-0 text-ink/60"
            aria-label="Refresh sessions"
            aria-busy={refreshing}
          >
            <RefreshCw 
              size={14} 
              className={`hover:text-ink ${refreshing ? 'animate-spin' : ''}`} 
            />
          </button>
        </div>
        <div className="flex space-x-3 items-center relative">
          <Search 
            size={14} 
            className={`cursor-pointer transition-colors ${isSearchVisible ? 'text-ink' : 'hover:text-ink'}`} 
             
            onClick={onToggleSearch} 
          />
          <span 
            title={showArchived ? "Hide Archive" : "Show Archive"} 
            onClick={onToggleArchived}
            className="inline-flex cursor-pointer"
          >
            <Archive 
              size={14} 
              className={`transition-colors ${showArchived ? 'text-ink' : 'hover:text-ink'}`} 
            />
          </span>
          
          <div className="relative">
            <MoreHorizontal 
              size={14} 
              className={`cursor-pointer transition-colors ${optionsOpen ? 'text-ink' : 'hover:text-ink'}`} 
               
              onClick={onToggleOptions} 
            />
            {optionsOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-paper border border-ink/10 rounded shadow-lg z-50 py-1" onMouseLeave={onCloseOptions}>
                <SortMenu variant="desktop" sortOption={sortOption} onSortChange={onSortChange} />
              </div>
            )}
          </div>

          <PanelLeftClose size={14} className="hover:text-ink cursor-pointer ml-1" onClick={onClose} />
        </div>
      </div>
      
      {/* Search Field */}
      {isSearchVisible && (
        <div className="pt-1">
          <input 
            type="text" 
            placeholder="Search workspaces & sessions..." 
            value={searchQuery}
            onChange={(e) => onSearchChange(e.currentTarget.value)}
            autoFocus
            className="w-full bg-ink/5 border border-ink/10 rounded px-2.5 py-1.5 outline-none focus:border-ink/30 text-xs text-ink placeholder-ink/40 transition-colors" 
          />
        </div>
      )}
      
      {/* Archive Status Pill */}
      {showArchived && (
        <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/20 text-amber-900 rounded px-2.5 py-1.5 text-[10px] font-medium">
          <div className="flex items-center space-x-1.5">
            <Archive size={10} />
            <span>Showing Archived</span>
          </div>
          <button className="hover:text-amber-950" onClick={onHideArchived}>
            <X size={10} />
          </button>
        </div>
      )}
    </div>
  );
}
