import type { LucideIcon } from 'lucide-preact';
import { BarChart3, Bell, BookOpen, Bot, Boxes, Cloud, Coins, Cpu, FolderGit, Library, MessageSquare, Palette, Plug, Power, Puzzle, RefreshCw, Search, Sliders, Terminal, Waypoints, X } from 'lucide-preact';
import { HarnessGlyph } from '@/client/components/common/harness-glyph';
import type { SettingsCategoryId } from '@/shared/types';
import { SETTINGS_SECTIONS, type SettingsSection } from '@/shared/lib/settings/sections';
import { harnessMenuEntries } from '@/shared/lib/harness/menu';

export interface CategoryDef {
  id: SettingsCategoryId;
  label: string;
  icon: LucideIcon;
  section: SettingsSection;
  /** The AGENT this entry is a page for, when it is one. Its row then draws the
   *  vendor's own mark instead of a lucide shape — the sidebar is where a reader
   *  identifies an agent by its logo everywhere else in the app, and a generic
   *  `Waypoints` glyph beside "claude" is a shape nobody recognises. */
  harness?: string;
  badge?: string;
  description: string;
}

export const SETTINGS_CATEGORIES: CategoryDef[] = [
  // KABMO
  { id: 'appearance', label: 'Appearance', icon: Palette, section: 'KABMO', description: 'Custom themes, typography scale, and layout density.' },
  { id: 'chats', label: 'Chats', icon: MessageSquare, section: 'KABMO', description: 'Chat width, composer style, tool call rendering, session titles, goal mode, and keybindings.' },
  { id: 'notifications', label: 'Notifications', icon: Bell, section: 'KABMO', description: 'Completion sound, separate Desktop and Mobile delivery switches, and the finished, waiting-for-you and failed run triggers.' },
  { id: 'usage', label: 'Usage', icon: BarChart3, section: 'KABMO', description: 'Build minutes quota, storage, and general usage.' },
  { id: 'token-usage', label: 'Token Usage', icon: Coins, section: 'KABMO', description: 'Token telemetry, cache, and cost breakdown.' },
  { id: 'panel-plugins', label: 'Plugins Kabmo', icon: Puzzle, section: 'KABMO', description: 'Plugins installed into Kabmo: panels, background services, and the MCP servers they register.' },
  // WORKSPACE
  { id: 'projects', label: 'Projects', icon: FolderGit, section: 'WORKSPACE', description: 'Workspace directories, roots, and ignored paths.' },
  // OMP
  { id: 'omp', label: 'OMP Engine', icon: Cpu, section: 'OMP', description: 'Live agent state and native omp config keys.' },
  { id: 'providers', label: 'Providers', icon: Cloud, section: 'OMP', description: 'AI model engines, endpoints, and credentials.' },
  { id: 'agents', label: 'Agents', icon: Bot, section: 'OMP', description: 'Autonomous agent persona, self-healing, and reasoning.' },
  { id: 'behavior', label: 'Behavior', icon: Sliders, section: 'OMP', description: 'Native AGENTS.md and RULES.md: global instructions, permission gates, and safety filters.' },
  { id: 'commands', label: 'Commands', icon: Terminal, section: 'OMP', description: 'Slash command macros and terminal shortcuts.' },
  { id: 'mcp', label: 'MCP', icon: Boxes, section: 'OMP', description: 'Model Context Protocol servers and dynamic tools.' },
  // HARNESSES
  // HARNESSES — one page per agent, derived from the catalog. `harnessMenuEntries`
  // returns the overview first, then each non-built-in harness in catalog order.
  ...harnessMenuEntries().map((entry) => ({
    id: entry.id,
    label: entry.label,
    // The overview keeps a lucide glyph: it is not an agent, so a brand mark
    // would claim it were one.
    icon: Waypoints,
    section: 'HARNESSES' as const,
    ...(entry.harness ? { harness: entry.harness } : {}),
    description: entry.description,
  })),
  // LIBRARY
  { id: 'plugins', label: 'Plugins', icon: Plug, section: 'LIBRARY', description: 'Installed omp plugins, marketplaces, features, and plugin settings.' },
  { id: 'skills', label: 'Skills', icon: Library, section: 'LIBRARY', description: 'Manage downloaded skills and scripts.' },
  { id: 'skills-catalog', label: 'Skills Catalog', icon: BookOpen, section: 'LIBRARY', description: 'Browse and install new skills.' },
];

interface SettingsSidebarProps {
  activeCategory: SettingsCategoryId;
  onSelectCategory: (id: SettingsCategoryId) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onReloadOmp: () => void;
  isReloading: boolean;
  onRestartKabmo: () => void;
  isRestarting: boolean;
  /** Harness ids the user switched OFF: their rows leave the drawer. */
  disabledHarnesses?: string[];
  className?: string;
}

export function SettingsSidebar({
  activeCategory,
  onSelectCategory,
  searchQuery,
  onSearchChange,
  onReloadOmp,
  isReloading,
  onRestartKabmo,
  isRestarting,
  disabledHarnesses = [],
  className = ''
}: SettingsSidebarProps) {
  // A switched-off agent has no row here. The catalog list above stays complete
  // on purpose — it is what the build KNOWS, and the All Harnesses page draws
  // every entry in it with the switch that decides this. The ids arrive as a
  // PROP rather than from `useHarnesses()` so the drawer stays presentational:
  // it is drawn in table tests that must not fire a catalog read.
  const filteredCategories = SETTINGS_CATEGORIES.filter(cat => {
    if (cat.harness && disabledHarnesses.includes(cat.harness)) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return cat.label.toLowerCase().includes(q) ||
      cat.section.toLowerCase().includes(q) ||
      cat.description.toLowerCase().includes(q);
  });


  return (
    <div className={`flex flex-col h-full bg-canvas border-r border-ink/10 text-ink select-none ${className}`}>
      {/* Search Bar */}
      <div className="p-3 border-b border-ink/10 flex-shrink-0">
        <div className="relative flex items-center">
          <Search size={14} className="absolute left-2.5 text-ink/40 pointer-events-none" />
          <input
            type="text"
            placeholder="Search settings"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.currentTarget.value)}
            className="w-full bg-paper border border-ink/15 rounded-lg pl-8 pr-7 py-1.5 text-xs text-ink placeholder-ink/40 focus:outline-none focus:border-ink/40 transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2 text-ink/40 hover:text-ink p-0.5"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Category Navigation Items */}
      <div className="flex-1 scrollbar-overlay-container p-2 space-y-4">
        {filteredCategories.length === 0 ? (
          <div className="text-center py-8 text-xs text-ink/50 italic">
            No matching settings found
          </div>
        ) : (
          SETTINGS_SECTIONS.map(section => {
            const items = filteredCategories.filter(c => c.section === section);
            if (items.length === 0) return null;

            return (
              <div key={section} className="space-y-1">
                <div className="px-2.5 py-1 text-[10px] font-bold text-ink/40 tracking-wider font-mono uppercase">
                  {section}
                </div>
                <div className="space-y-0.5">
                  {items.map(item => {
                    const Icon = item.icon;
                    const isActive = activeCategory === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelectCategory(item.id)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all text-left ${
                          isActive
                            ? 'bg-ink/10 font-semibold text-ink shadow-2xs'
                            : 'text-ink/75 hover:bg-ink/5 hover:text-ink'
                        }`}
                      >
                        <div className="flex items-center space-x-2.5 truncate">
                          {/* The agent's own mark, at the size the lucide glyphs
                              draw, so a mixed list keeps one rhythm. The slot is
                              fixed width because the marks' viewBoxes differ
                              (omp is 64x64, the rest 24x24) and a bare inline
                              svg would shift every label beside it. */}
                          {item.harness ? (
                            <span className="flex w-[14px] shrink-0 items-center justify-center">
                              <HarnessGlyph harness={item.harness} size={14} />
                            </span>
                          ) : (
                            <Icon size={14} className={isActive ? 'text-ink' : 'text-ink/60'} />
                          )}
                          <span className="truncate">{item.label}</span>
                        </div>
                        {item.badge && (
                          <span className="px-1.5 py-0.2 text-[10px] font-mono font-medium rounded border border-warning/30 bg-warning/15 text-warning">
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Actions: Reload OMP + Restart Kabmo */}
      <div className="p-2 border-t border-ink/10 flex-shrink-0 bg-canvas flex items-center gap-0.5">
        <button
          type="button"
          onClick={onReloadOmp}
          disabled={isReloading || isRestarting}
          title="Recycle the standby omp processes so the next command uses the installed binary"
          aria-label="Reload OMP"
          className="shrink-0 flex items-center space-x-1 px-1 py-1.5 text-[11px] text-ink/75 hover:text-ink hover:bg-ink/5 rounded-lg transition-colors font-medium cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <RefreshCw size={12} className={`shrink-0 ${isReloading ? 'animate-spin text-warning' : 'text-ink/60'}`} />
          <span className="whitespace-nowrap">{isReloading ? 'Reloading…' : 'Reload OMP'}</span>
        </button>
        <button
          type="button"
          onClick={onRestartKabmo}
          disabled={isReloading || isRestarting}
          title="Stop and start this Kabmo instance"
          aria-label="Restart Kabmo"
          className="flex-1 min-w-0 flex items-center space-x-1 px-1 py-1.5 text-[11px] text-ink/75 hover:text-ink hover:bg-ink/5 rounded-lg transition-colors font-medium cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Power size={12} className={`shrink-0 ${isRestarting ? 'animate-pulse text-warning' : 'text-ink/60'}`} />
          <span className="truncate">{isRestarting ? 'Restarting…' : 'Restart Kabmo'}</span>
        </button>
      </div>
    </div>
  );
}
