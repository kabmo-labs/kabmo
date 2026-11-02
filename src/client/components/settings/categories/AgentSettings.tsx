import { useState } from 'preact/hooks';
import type { FunctionComponent } from 'preact/compat';
import type { AgentItem, SettingsState } from '@/shared/types';
import { AgentSidebarList } from '@/client/components/settings/categories/agent-settings/SidebarList';
import { AgentDetailPane } from '@/client/components/settings/categories/agent-settings/DetailPane';
import { LoadingState } from '@/client/components/settings/LoadingState';
import { useCrudList } from '@/client/hooks/settings/crud-list';
import { useSettingsMasterDetail } from '@/client/hooks/settings/master-detail';
import { SettingsMasterDetail } from '@/client/components/settings/master-detail';
import { GLOBAL_SCOPE_ID, useWorkspaceRoots } from '@/client/hooks/settings/workspace-roots';

interface AgentSettingsProps {
  settings: SettingsState;
  onUpdate: (settings: SettingsState) => void;
}

/**
 * The Agents panel, scoped to one project at a time.
 *
 * The project picker used to offer three hardcoded names and do nothing with
 * the choice — `selectedProject` was local state no request read, so
 * `<workspace>/.omp/agents` was unreachable from the one screen whose job is
 * listing agents. It now scopes the read through the same `?root=` contract the
 * skills and commands panels use, so the three panels agree about what a
 * project scope is.
 */
export const AgentSettings: FunctionComponent<AgentSettingsProps> = () => {
  const masterDetail = useSettingsMasterDetail();
  const roots = useWorkspaceRoots();
  const [selectedRootId, setSelectedRootId] = useState<string>(GLOBAL_SCOPE_ID);
  const query = roots.queryFor(selectedRootId);

  const { items: agents, selectedId, selected: selectedAgent, isCreatingNew, isLoading, select, startCreate, save, remove } =
    useCrudList<AgentItem>({
      endpoint: '/api/settings/agents',
      query,
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

  // A different scope is a different list: `useCrudList` re-reads when the query
  // changes and resolves its selection against the new list, so no extra reset
  // is needed here.
  if (isLoading) {
    return <LoadingState>Loading agents…</LoadingState>;
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
            selectedProject={selectedRootId}
            onChangeProject={setSelectedRootId}
            projectOptions={roots.options}
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
              <div className="flex-1 flex items-center justify-center px-6 text-center text-xs text-ink/40">
                {roots.isWorkspace(selectedRootId)
                  ? 'No agents in this project. Create one, or pick Global.'
                  : 'Select an agent or click + to create one.'}
              </div>
            )}
          </div>
        }
      />
    </div>
  );
};
