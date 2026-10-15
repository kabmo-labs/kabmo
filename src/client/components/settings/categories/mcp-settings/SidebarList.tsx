import type { FunctionComponent } from 'preact/compat';
import { Globe, Plus, Terminal } from 'lucide-preact';
import type { McpServerItem } from '@/shared/types';
import { ProjectSelectorDropdown } from '@/client/components/settings/ProjectSelectorDropdown';

export interface McpProjectOption {
  id: string;
  name: string;
  path: string;
}

interface McpSidebarListProps {
  servers: McpServerItem[];
  projects: McpProjectOption[];
  selectedServerId: string | null;
  onSelectServer: (serverId: string) => void;
  onAddNewServer: () => void;
  selectedProject: string;
  onChangeProject: (projectPath: string) => void;
}

export const McpSidebarList: FunctionComponent<McpSidebarListProps> = ({
  servers,
  projects,
  selectedServerId,
  onSelectServer,
  onAddNewServer,
  selectedProject,
  onChangeProject,
}) => {
  const activeProjectName = projects.find((proj) => proj.path === selectedProject)?.name ?? 'Global (all projects)';

  return (
    <div className="w-full md:w-64 md:border-r border-ink/10 h-full flex flex-col bg-paper/50 flex-shrink-0 select-none">
      <ProjectSelectorDropdown
        selectedProject={selectedProject}
        onChangeProject={onChangeProject}
        options={projects.map((project) => ({
          id: project.id,
          name: project.name,
          label: project.name,
          value: project.path,
        }))}
        getTriggerLabel={() => activeProjectName}
      />

      <div className="px-3.5 py-2.5 border-b border-ink/10 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink">
          Total {servers.length}
        </span>
        <button
          type="button"
          onClick={onAddNewServer}
          title="Add MCP Server"
          className="p-1 rounded text-ink/60 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
        >
          <Plus size={15} strokeWidth={2.2} />
        </button>
      </div>

      <div className="flex-1 scrollbar-overlay-container p-1.5 space-y-3 text-xs">
        <div>
          <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold text-ink/50 uppercase tracking-wider flex items-center justify-between">
            <span>User Servers</span>
            <span className="text-[10px] font-normal">{servers.length}</span>
          </div>

          <div className="space-y-0.5">
            {servers.map((server) => {
              const isSelected = server.id === selectedServerId;
              const isCommand = server.reachType === 'command';
              const summary = isCommand
                ? server.commandArgs.join(' ')
                : server.linkUrl || 'No URL configured';

              return (
                <button
                  key={server.id}
                  type="button"
                  onClick={() => onSelectServer(server.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors cursor-pointer flex flex-col gap-0.5 group ${
                    isSelected
                      ? 'bg-ink/10 text-ink font-medium shadow-2xs'
                      : 'text-ink/80 hover:bg-ink/5 hover:text-ink'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          server.enabled ? 'bg-ink' : 'bg-ink/20'
                        }`}
                        title={server.enabled ? 'Enabled' : 'Disabled'}
                      />
                      <span className="font-semibold text-xs text-ink truncate">
                        {server.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-ink/40">
                      {isCommand ? (
                        <Terminal className="w-3.5 h-3.5" />
                      ) : (
                        <Globe className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </div>

                  <p className="text-[11px] font-mono text-ink/60 line-clamp-1 leading-snug pl-4">
                    {summary}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
