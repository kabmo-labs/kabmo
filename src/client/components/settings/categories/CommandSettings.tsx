import { useRef, useState } from 'preact/hooks';
import type { FunctionComponent } from 'preact/compat';
import type { CommandItem, SettingsState } from '@/shared/types';
import { CommandSidebarList } from '@/client/components/settings/categories/command-settings/SidebarList';
import { CommandDetailPane } from '@/client/components/settings/categories/command-settings/DetailPane';
import { LoadingState } from '@/client/components/settings/LoadingState';
import { useCrudList } from '@/client/hooks/settings/crud-list';
import { useSettingsMasterDetail } from '@/client/hooks/settings/master-detail';
import { SettingsMasterDetail } from '@/client/components/settings/master-detail';
import { GLOBAL_SCOPE_ID, useWorkspaceRoots } from '@/client/hooks/settings/workspace-roots';

interface CommandSettingsProps {
  settings: SettingsState;
  onUpdate: (settings: SettingsState) => void;
}

/**
 * The Commands panel, scoped to one root at a time.
 *
 * The list is omp's own `get_available_commands` for the selected scope: the
 * builtins, the `skill:<name>` entries, extension and TypeScript commands, and
 * every markdown command file omp discovers — the user-level
 * `~/.omp/agent/commands`, `~/.claude/commands`, … plus the selected
 * workspace's `.omp/commands`, `.claude/commands`, `.agents/commands` and
 * `.github/prompts`. The server resolves each live name against those roots so
 * the pane can tell a file command (editable, and the file is the truth) from
 * a builtin (read-only), and reports the scope each one lives at.
 */
export const CommandSettings: FunctionComponent<CommandSettingsProps> = () => {
  const masterDetail = useSettingsMasterDetail();
  const roots = useWorkspaceRoots();
  const [selectedRootId, setSelectedRootId] = useState<string>(GLOBAL_SCOPE_ID);
  // The name a command had when it was selected: a rename has to travel so the
  // file is moved rather than left behind as a second command. Read from a ref
  // because the save body is built outside the list controller's own state.
  const selectedNameRef = useRef<string | null>(null);
  const query = roots.queryFor(selectedRootId);
  const isWorkspaceScope = roots.isWorkspace(selectedRootId);

  const { items: commands, selectedId, selected: selectedCommand, isCreatingNew, isLoading, loadError, reload, select, startCreate, save, remove } =
    useCrudList<CommandItem>({
      endpoint: '/api/settings/commands',
      query,
      listKey: 'commands',
      bodyKey: 'command',
      messages: {
        load: 'Failed to load commands from API:',
        save: 'Failed to save command via API:',
        delete: 'Failed to delete command via API:',
      },
      cacheKey: 'command',
      // A live command's id is derived from its name; the rename has to travel
      // so the file is moved rather than duplicated.
      buildBody: (target) => ({
        command: target,
        ...roots.scopeBodyFor(selectedRootId),
        ...(selectedNameRef.current ? { previousName: selectedNameRef.current } : {}),
      }),
      buildDeleteQuery: (id) => `?id=${encodeURIComponent(id)}&${query.slice(1)}`,
      buildNew: (updated) => ({
        ...updated,
        id: `cmd-${Date.now()}`,
        isBuiltIn: false,
        scope: isWorkspaceScope ? 'project' : 'user',
      }),
      buildUpdate: (updated) => updated,
    });

  const emptyCommandTemplate: CommandItem = {
    id: `new-${Date.now()}`,
    name: 'new-command',
    description: '',
    scope: isWorkspaceScope ? 'project' : 'user',
    template: 'Execute task: $ARGUMENTS',
    isBuiltIn: false,
  };

  if (isLoading) {
    return <LoadingState>Loading commands…</LoadingState>;
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-paper">
      <SettingsMasterDetail
        pane={masterDetail.pane}
        onBack={masterDetail.back}
        listLabel="Commands"
        list={
          <CommandSidebarList
            commands={commands}
            selectedCommandId={isCreatingNew ? null : selectedId}
            onSelectCommand={(id) => {
              selectedNameRef.current = commands.find((command) => command.id === id)?.name ?? null;
              select(id);
              masterDetail.openDetail();
            }}
            onAddNewCommand={() => {
              selectedNameRef.current = null;
              startCreate();
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
            {isCreatingNew ? (
              <CommandDetailPane
                command={emptyCommandTemplate}
                isNew={true}
                onSave={save}
                projectScopeDisabled={!isWorkspaceScope}
              />
            ) : selectedCommand ? (
              <CommandDetailPane
                key={selectedCommand.id}
                command={selectedCommand}
                isNew={false}
                onSave={save}
                onDelete={remove}
                projectScopeDisabled={!isWorkspaceScope}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs font-mono text-ink/40">
                Select a command or click + to create one
              </div>
            )}
          </div>
        }
      />
    </div>
  );
};
