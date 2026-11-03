import { useMemo, useState } from 'preact/hooks';
import type { FunctionComponent } from 'preact/compat';
import type { McpServerItem, SettingsState, WriteOutcome } from '@/shared/types';
import { McpSidebarList } from '@/client/components/settings/categories/mcp-settings/SidebarList';
import type { McpProjectOption } from '@/client/components/settings/categories/mcp-settings/SidebarList';
import { McpDetailPane } from '@/client/components/settings/categories/mcp-settings/DetailPane';
import { McpImportModal } from '@/client/components/settings/categories/mcp-settings/ImportModal';
import { LoadingState } from '@/client/components/settings/LoadingState';
import { useSidebarData } from '@/client/hooks/chat/omp/session-list';
import { useCrudList } from '@/client/hooks/settings/crud-list';
import { useSettingsMasterDetail } from '@/client/hooks/settings/master-detail';
import { SettingsMasterDetail } from '@/client/components/settings/master-detail';

interface McpSettingsProps {
  settings: SettingsState;
  onUpdate: (settings: SettingsState) => void;
}

const GLOBAL_PROJECT: McpProjectOption = { id: 'global', name: 'Global (all projects)', path: '' };

export const McpSettings: FunctionComponent<McpSettingsProps> = () => {
  const masterDetail = useSettingsMasterDetail();
  const { folders } = useSidebarData();
  const projects = useMemo<McpProjectOption[]>(() => {
    const bound = folders.flatMap<McpProjectOption>((folder) =>
      folder.project_path ? [{ id: String(folder.id), name: folder.name, path: folder.project_path }] : [],
    );
    return [GLOBAL_PROJECT, ...bound];
  }, [folders]);

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState('');

  const query = selectedProject ? `?project=${encodeURIComponent(selectedProject)}` : '';

  const { items: servers, selectedId, selected: selectedServer, isCreatingNew, isLoading, loadError, reload, select, startCreate, save, remove } =
    useCrudList<McpServerItem>({
      endpoint: '/api/settings/mcp',
      listKey: 'servers',
      bodyKey: 'server',
      query,
      messages: {
        load: 'Failed to load MCP servers from API:',
        save: 'Failed to save MCP server via API:',
        delete: 'Failed to delete MCP server via API:',
      },
      serverListOnly: true,
      deleteFromResponse: true,
      buildNew: (updated) => ({ ...updated, id: `mcp-${Date.now()}` }),
      buildUpdate: (updated) => updated,
      buildBody: (target) =>
        selectedProject ? { server: target, projectPath: selectedProject } : { server: target },
      buildDeleteQuery: (id) => {
        const params = new URLSearchParams({ id });
        if (selectedProject) params.set('projectPath', selectedProject);
        return `?${params.toString()}`;
      },
      readList: (data) => (Array.isArray((data as { servers?: unknown } | null)?.servers) ? (data as { servers: McpServerItem[] }).servers : null),
      resolveOnLoad: (prev, list) => (prev && list.some((s) => s.id === prev) ? prev : list[0]?.id ?? null),
      resolveOnSave: (target, list) => {
        if (!list) return undefined;
        const saved = list.find((s) => s.name.toLowerCase() === target.name.toLowerCase());
        return saved?.id ?? target.id;
      },
    });

  const handleImportServer = (imported: McpServerItem): Promise<WriteOutcome> => save(imported);

  const emptyServerTemplate: McpServerItem = {
    id: `new-${Date.now()}`,
    name: 'new-mcp-server',
    scope: 'every-project',
    enabled: true,
    reachType: 'command',
    commandArgs: ['bunx', '@modelcontextprotocol/server-everything'],
    envVars: [],
    status: 'active',
  };

  if (isLoading) {
    return <LoadingState>Loading MCP servers from database...</LoadingState>;
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-paper">
      <SettingsMasterDetail
        pane={masterDetail.pane}
        onBack={masterDetail.back}
        listLabel="MCP Servers"
        list={
          <McpSidebarList
            servers={servers}
            projects={projects}
            selectedServerId={isCreatingNew ? null : selectedId}
            onSelectServer={(id) => {
              select(id);
              masterDetail.openDetail();
            }}
            onAddNewServer={() => {
              startCreate();
              masterDetail.openDetail();
            }}
            selectedProject={selectedProject}
            onChangeProject={setSelectedProject}
            {...(loadError ? { loadError, onRetry: reload } : {})}
          />
        }
        detail={
          <div className="flex-1 h-full overflow-hidden flex flex-col">
            {isCreatingNew ? (
              <McpDetailPane
                server={emptyServerTemplate}
                isNew={true}
                onSave={save}
                onOpenImportModal={() => setIsImportModalOpen(true)}
              />
            ) : selectedServer ? (
              <McpDetailPane
                key={selectedServer.id}
                server={selectedServer}
                isNew={false}
                onSave={save}
                onDelete={remove}
                onOpenImportModal={() => setIsImportModalOpen(true)}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs font-mono text-ink/40">
                Select an MCP server or click + to configure one
              </div>
            )}
          </div>
        }
      />

      <McpImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImport={handleImportServer}
      />
    </div>
  );
};
