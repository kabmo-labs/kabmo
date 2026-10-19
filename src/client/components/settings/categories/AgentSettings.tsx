import { useState } from 'preact/hooks';
import type { FunctionComponent } from 'preact/compat';
import type { AgentItem, SettingsState } from '@/shared/types';
import { AgentSidebarList } from '@/client/components/settings/categories/agent-settings/SidebarList';
import { AgentDetailPane } from '@/client/components/settings/categories/agent-settings/DetailPane';
import { LoadingState } from '@/client/components/settings/LoadingState';
import { useCrudList } from '@/client/hooks/settings/crud-list';
import { useSettingsMasterDetail } from '@/client/hooks/settings/master-detail';
import { SettingsMasterDetail } from '@/client/components/settings/master-detail';

interface AgentSettingsProps {
  settings: SettingsState;
  onUpdate: (settings: SettingsState) => void;
}

export const AgentSettings: FunctionComponent<AgentSettingsProps> = () => {
  const masterDetail = useSettingsMasterDetail();
  const [selectedProject, setSelectedProject] = useState('kabmo');
  const { items: agents, selectedId, selected: selectedAgent, isCreatingNew, isLoading, select, startCreate, save, remove } =
    useCrudList<AgentItem>({
      endpoint: '/api/settings/agents',
      listKey: 'agents',
      bodyKey: 'agent',
      messages: {
        load: 'Failed to load agents from API:',
        save: 'Failed to save agent via API:',
        delete: 'Failed to delete agent via API:',
      },
      cacheKey: 'agent',
      buildNew: (updated) => ({ ...updated, id: `agent-${Date.now()}`, isBuiltIn: false }),
      buildUpdate: (updated) => updated,
      isDeleteError: (data) => Boolean((data as { error?: string } | null)?.error),
    });

  const emptyAgentTemplate: AgentItem = {
    id: `new-${Date.now()}`,
    name: 'new-agent',
    description: '',
    scope: 'user',
    mode: 'subagent',
    overrideModel: 'Not selected',
    thinkingVariant: 'default',
    temperature: null,
    topP: null,
    systemPrompt: 'You are a specialized assistant...',
    isBuiltIn: false,
  };

  if (isLoading) {
    return <LoadingState>Loading agents from database...</LoadingState>;
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-paper">
      <SettingsMasterDetail
        pane={masterDetail.pane}
        onBack={masterDetail.back}
        listLabel="Agents"
        list={
          <AgentSidebarList
            agents={agents}
            selectedAgentId={isCreatingNew ? null : selectedId}
            onSelectAgent={(id) => {
              select(id);
              masterDetail.openDetail();
            }}
            onAddNewAgent={() => {
              startCreate();
              masterDetail.openDetail();
            }}
            selectedProject={selectedProject}
            onChangeProject={setSelectedProject}
          />
        }
        detail={
          <div className="flex-1 h-full overflow-hidden flex flex-col">
            {isCreatingNew ? (
              <AgentDetailPane
                agent={emptyAgentTemplate}
                isNew={true}
                onSave={save}
              />
            ) : selectedAgent ? (
              <AgentDetailPane
                key={selectedAgent.id}
                agent={selectedAgent}
                isNew={false}
                onSave={save}
                onDelete={remove}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs font-mono text-ink/40">
                Select an agent or click + to create one
              </div>
            )}
          </div>
        }
      />
    </div>
  );
};
