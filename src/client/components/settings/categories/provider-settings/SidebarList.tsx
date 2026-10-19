
import { useRef, useState } from 'preact/hooks';
import { Check, ChevronDown, Folder, Plus } from 'lucide-preact';
import type { ProviderItem } from '@/shared/types';
import { ProviderIcon } from '@/client/components/common/provider-icon';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';

interface ProviderSidebarListProps {
  providers: ProviderItem[];
  selectedProviderId: string;
  onSelectProvider: (id: string) => void;
  onOpenAddModal: () => void;
  projects?: Array<{ id: string; name: string }>;
  currentProject: string;
  onSelectProject: (name: string) => void;
}

export function ProviderSidebarList({
  providers,
  selectedProviderId,
  onSelectProvider,
  onOpenAddModal,
  projects = [
    { id: 'proj-kabmo', name: 'kabmo' },
    { id: 'proj-workspace', name: 'Workspace' },
    { id: 'proj-drrealhandler', name: 'drrealhandler' },
    { id: 'proj-opencode-zen', name: 'opencode-zen' },
  ],
  currentProject,
  onSelectProject,
}: ProviderSidebarListProps) {
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useOnClickOutside(dropdownRef, () => setIsProjectDropdownOpen(false));

  return (
    <div className="w-full md:w-64 md:border-r border-ink/10 h-full flex flex-col bg-paper/50 flex-shrink-0">
      {/* 1. Project Selector Dropdown */}
      <div className="p-3 border-b border-ink/10 relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
          className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper text-ink text-xs font-medium transition-colors cursor-pointer shadow-2xs"
        >
          <div className="flex items-center gap-2 truncate">
            <Folder size={14} className="text-ink/60 flex-shrink-0" />
            <span className="truncate">{currentProject}</span>
          </div>
          <ChevronDown size={14} className="text-ink/50 flex-shrink-0" />
        </button>

        {isProjectDropdownOpen && (
          <div className="absolute left-3 right-3 mt-1.5 bg-paper border border-ink/15 rounded-lg shadow-xl py-1 z-50 max-h-56 scrollbar-overlay-container">
            {projects.map((proj) => (
              <button
                key={proj.id}
                type="button"
                onClick={() => {
                  onSelectProject(proj.name);
                  setIsProjectDropdownOpen(false);
                }}
                className="w-full flex items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-ink/5 transition-colors cursor-pointer"
              >
                <span className={proj.name === currentProject ? 'font-semibold text-ink' : 'text-ink/80'}>
                  {proj.name}
                </span>
                {proj.name === currentProject && <Check size={13} className="text-ink" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 2. Total Count & Add Button */}
      <div className="px-3.5 py-2.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink/70">
          Total {providers.length}
        </span>
        <button
          type="button"
          onClick={onOpenAddModal}
          title="Add Provider"
          className="p-1 rounded text-ink/60 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
        >
          <Plus size={15} strokeWidth={2.2} />
        </button>
      </div>

      {/* 3. Section Header: USER PROVIDERS */}
      <div className="px-3.5 pt-1 pb-1.5">
        <span className="text-[10px] font-semibold tracking-wider text-ink/50 uppercase">
          User Providers
        </span>
      </div>

      {/* 4. Provider List */}
      <div className="flex-1 scrollbar-overlay-container p-1.5 space-y-0.5">
        {providers.length === 0 ? (
          <div className="px-2.5 py-4 text-[11px] leading-relaxed text-ink/50">
            No connected providers yet. Use the plus button above to add one.
          </div>
        ) : providers.map((item) => {
          const isSelected = item.id === selectedProviderId;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectProvider(item.id)}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-left transition-colors cursor-pointer group ${
                isSelected
                  ? 'bg-ink/10 text-ink font-medium shadow-2xs'
                  : 'text-ink/80 hover:bg-ink/5 hover:text-ink'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <ProviderIcon icon={item.icon} slug={item.slug} name={item.name} size={15} className="flex-shrink-0" />
                <span className="text-[12px] truncate">{item.name}</span>
              </div>

              <span className={`text-[11px] px-1.5 py-0.5 rounded font-mono ${
                isSelected ? 'text-ink/90 bg-ink/10' : 'text-ink/50 group-hover:text-ink/70'
              }`}>
                {item.models.length}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
