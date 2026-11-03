import { useState } from 'preact/hooks';
import type { FunctionComponent } from 'preact/compat';
import type { SettingsState } from '@/shared/types';
import { AgentSidebarList } from '@/client/components/settings/categories/agent-settings/SidebarList';
import { AgentDetailPane } from '@/client/components/settings/categories/agent-settings/DetailPane';
import { LoadingState } from '@/client/components/settings/LoadingState';
import { useAgents } from '@/client/hooks/settings/agents';
import { useSettingsMasterDetail } from '@/client/hooks/settings/master-detail';
import { SettingsMasterDetail } from '@/client/components/settings/master-detail';
import { GLOBAL_SCOPE_ID, useWorkspaceRoots } from '@/client/hooks/settings/workspace-roots';
import { emptyAgentTemplate } from '@/client/components/settings/categories/agent-settings/levels';

interface AgentSettingsProps {
  settings: SettingsState;
  onUpdate: (settings: SettingsState) => void;
}

/**
 * The Agents panel, scoped to one project at a time.
 *
 * The list IS omp's agent definitions — `~/.omp/agent/agents/*.md` plus the
 * selected workspace's `.omp/agents/*.md` — read and written as files, because
 * that is where omp loads agents from. It used to read a Kabmo-local mirror and
 * POST edits into it, so a saved agent never reached the agent omp ran.
 */
export const AgentSettings: FunctionComponent<AgentSettingsProps> = () => {
  const masterDetail = useSettingsMasterDetail();
  const roots = useWorkspaceRoots();
  const [selectedRootId, setSelectedRootId] = useState<string>(GLOBAL_SCOPE_ID);
  const [isCreating, setIsCreating] = useState(false);
  const query = roots.queryFor(selectedRootId);

  const { agents, selectedId, selected: selectedAgent, isLoading, loadError, reload, select, save, remove } = useAgents(query);

  if (isLoading) {
    return <LoadingState>Reading omp’s agent definitions…</LoadingState>;
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
            selectedAgentId={isCreating ? null : selectedId}
            onSelectAgent={(id) => {
              setIsCreating(false);
              select(id);
              masterDetail.openDetail();
            }}
            onAddNewAgent={() => {
              setIsCreating(true);
              masterDetail.openDetail();
            }}
            selectedProject={selectedRootId}
            onChangeProject={setSelectedRootId}
            projectOptions={roots.options}
            {...(loadError ? { loadError, onRetry: reload } : {})}
          />
        }
        detail={
          <div className="flex-1 h-full overflow-hidden flex flex-col">
            {isCreating ? (
              <AgentDetailPane
                agent={emptyAgentTemplate()}
                isNew={true}
                onSave={(draft) => save(draft)}
              />
            ) : selectedAgent ? (
              <AgentDetailPane
                key={selectedAgent.id}
                agent={selectedAgent}
                onSave={(draft) => save(draft, selectedAgent.fileName)}
                onDelete={async (agent) => {
                  const outcome = await remove(agent);
                  if (outcome.ok) masterDetail.back();
                  return outcome;
                }}
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
