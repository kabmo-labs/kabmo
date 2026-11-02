import type { FunctionComponent } from 'preact/compat';
import { Bot } from 'lucide-preact';
import type { AgentItem } from '@/shared/types';
import type { ProjectOption } from '@/client/components/settings/ProjectSelectorDropdown';
import { SettingsSidebarList } from '@/client/components/settings/SettingsSidebarList';

interface AgentSidebarListProps {
  agents: AgentItem[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onAddNewAgent: () => void;
  selectedProject: string;
  onChangeProject: (project: string) => void;
  /** Real workspace folders; defaults to the shared placeholder list. */
  projectOptions?: ProjectOption[];
}

export const AgentSidebarList: FunctionComponent<AgentSidebarListProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  onAddNewAgent,
  selectedProject,
  onChangeProject,
  projectOptions,
}) => (
  <SettingsSidebarList
    items={agents}
    selectedId={selectedAgentId}
    onSelect={onSelectAgent}
    onAddNew={onAddNewAgent}
    addTitle="Create new agent"
    builtInLabel="Built-in Agents"
    customLabel="Custom Agents"
    formatName={(name) => name}
    nameClassName="font-semibold text-xs text-ink truncate"
    selectedProject={selectedProject}
    onChangeProject={onChangeProject}
    {...(projectOptions ? { projectOptions } : {})}
    renderIcon={(isBuiltIn) => (
      <div className="relative">
        <Bot className={`w-3.5 h-3.5 ${isBuiltIn ? 'text-ink/80' : 'text-ink/60'} flex-shrink-0`} />
        {isBuiltIn && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-ink" />}
      </div>
    )}
  />
);
