import { useState } from 'preact/hooks';
import type { SettingsState, SkillItem } from '@/shared/types';
import { SkillSidebarList } from '@/client/components/settings/categories/skill-settings/SidebarList';
import { SkillDetailPane } from '@/client/components/settings/categories/skill-settings/DetailPane';
import { LoadingState } from '@/client/components/settings/LoadingState';
import { useCrudList } from '@/client/hooks/settings/crud-list';
import { useSettingsMasterDetail } from '@/client/hooks/settings/master-detail';
import { SettingsMasterDetail } from '@/client/components/settings/master-detail';
import { GLOBAL_SCOPE_ID, useWorkspaceRoots } from '@/client/hooks/settings/workspace-roots';

interface SkillSettingsProps {
  settings?: SettingsState;
  onUpdate?: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
  /** Opens the catalog, on the tab the click came from. */
  onNavigateToCatalog?: (tab?: 'browse' | 'git' | 'sources') => void;
}

/**
 * The Skills panel, scoped to one root at a time.
 *
 * The picker selects WHICH omp scope is read: a workspace root answers with the
 * skills an omp session started there loads (its `.omp/skills`, `.claude`,
 * `.agents`, `.github`, `.codex` entries plus the user-level ones), while the
 * user scope answers for the agent dir alone. That is not a client-side filter
 * — the server passes the scope's cwd to `omp skill list`, because omp's
 * project walk-up is what decides the list.
 *
 * A write lands in the scope that is selected: a project skill under
 * `<workspace>/.omp/skills`, a user skill under `~/.omp/agent/skills`.
 */
export function SkillSettings({ onNavigateToCatalog }: SkillSettingsProps) {
  const masterDetail = useSettingsMasterDetail();
  const roots = useWorkspaceRoots();
  const [selectedRootId, setSelectedRootId] = useState<string>(GLOBAL_SCOPE_ID);
  const [isReloading, setIsReloading] = useState(false);
  const query = roots.queryFor(selectedRootId);
  const isWorkspaceScope = roots.isWorkspace(selectedRootId);

  const { items: skills, selectedId, selected: selectedSkill, isCreatingNew, isLoading, select, startCreate, save, remove } =
    useCrudList<SkillItem, Partial<SkillItem>>({
      endpoint: '/api/settings/skills',
      query,
      listKey: 'skills',
      bodyKey: 'skill',
      messages: {
        load: 'Failed to load skills from API:',
        save: 'Failed to save skill via API:',
        delete: 'Failed to delete skill via API:',
      },
      cacheKey: 'command',
      fallbackToFirst: false,
      // The write carries the scope it was made in, because the draft's own
      // location decides which `.omp/skills` root it lands in.
      buildBody: (target) => ({ skill: target, ...roots.scopeBodyFor(selectedRootId) }),
      buildDeleteQuery: (id) => `?id=${encodeURIComponent(id)}&${query.slice(1)}`,
      buildNew: (skillData) => ({
        id: `skill-${Date.now()}`,
        name: skillData.name || 'new-skill',
        description: skillData.description || '',
        // A new skill defaults to the scope the panel is showing: creating a
        // project skill while the user scope is selected would write outside
        // the list they are looking at.
        location: skillData.location || (isWorkspaceScope ? 'project' : 'user'),
        locationLabel: skillData.locationLabel || (isWorkspaceScope ? 'Project / .omp/skills' : 'User / omp agent'),
        instructions: skillData.instructions || '',
        hidden: skillData.hidden === true,
        project: 'omp',
      }),
      buildUpdate: (skillData, selected, selectedId) => ({
        ...(selected || { id: selectedId || `skill-${Date.now()}` }),
        ...skillData,
      }) as SkillItem,
      isDeleteError: (data) => Boolean((data as { error?: string } | null)?.error),
    });

  const reload = () => {
    setIsReloading(true);
    fetch('/api/settings/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'reload', ...roots.scopeBodyFor(selectedRootId) }),
    })
      .catch((error) => console.error('Failed to reload skills:', error))
      .finally(() => setIsReloading(false));
  };

  if (isLoading) {
    return <LoadingState>Loading skills…</LoadingState>;
  }

  return (
    <div className="flex-1 flex flex-col h-full w-full overflow-hidden bg-paper">
      <SettingsMasterDetail
        pane={masterDetail.pane}
        onBack={masterDetail.back}
        listLabel="Skills"
        list={
          <SkillSidebarList
            skills={skills}
            selectedSkillId={selectedId}
            isCreatingNew={isCreatingNew}
            onSelectSkill={(id) => {
              select(id);
              masterDetail.openDetail();
            }}
            onAddNewSkill={() => {
              startCreate();
              masterDetail.openDetail();
            }}
            onImportFromGit={() => onNavigateToCatalog?.('git')}
            onOpenCatalog={() => onNavigateToCatalog?.('browse')}
            selectedProject={selectedRootId}
            onSelectProject={setSelectedRootId}
            projectOptions={roots.options}
          />
        }
        detail={
          <SkillDetailPane
            skill={selectedSkill ?? null}
            isCreatingNew={isCreatingNew}
            onSave={save}
            onDelete={remove}
            onOpenCatalog={() => onNavigateToCatalog?.('browse')}
            onReload={reload}
            isReloading={isReloading}
            projectScopeDisabled={!isWorkspaceScope}
            defaultLocation={isWorkspaceScope ? 'project' : 'user'}
          />
        }
      />
    </div>
  );
}
