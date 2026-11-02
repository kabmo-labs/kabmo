/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Projects pane's state: the folder list, one save path, and the failures
 * it has to report.
 *
 * The pane used to write on every keystroke and drop every failure into
 * `console.error`, so a refused rename (a duplicate name, an unbound path) left
 * the form showing the new value while the server kept the old one, and the
 * next refresh silently reverted it. Here a save is one request per committed
 * field, the server's own copy of the row is merged back (it trims names and
 * expands `~`), and a refusal is reported AND rolled back.
 *
 * The list is also re-read from the `sidebar` topic: another tab, the sidebar
 * menu and this pane all write the same rows, and one signal is what keeps the
 * three from disagreeing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AccentColorOption, ProjectConfigItem } from '@/shared/types';
import { useModelsCatalog } from '@/client/hooks/models/use-models-catalog';
import { useSidebarData } from '@/client/hooks/chat/omp/session-list';
import { isRecord } from '@/shared/lib/util/guards';

export interface ProjectModelChoice {
  provider: string;
  id: string;
  name: string;
}

export interface ProjectSettingsState {
  projects: ProjectConfigItem[];
  selected: ProjectConfigItem | null;
  selectedId: string;
  select: (id: string) => void;
  accentColorOptions: AccentColorOption[];
  /** Live catalog for the "Defaults for new chats" picker. */
  models: ProjectModelChoice[];
  isLoading: boolean;
  /** Why the list could not be read, or null. */
  loadError: string | null;
  /** Reload the list from the server. */
  refresh: () => Promise<void>;
  /**
   * Commit one field. Resolves `true` when the server holds the new value; the
   * list is reverted and `onError` called otherwise.
   */
  updateField: <K extends keyof ProjectConfigItem>(
    project: ProjectConfigItem,
    field: K,
    value: ProjectConfigItem[K],
  ) => Promise<boolean>;
  /**
   Commit SEVERAL fields as one write.
   *
   The icon is two facts (`icon` + `customIconUrl`) and they must land together:
   sent as two PATCHes they race, and whichever response arrives last decides the
   row — measured as an uploaded image that saved and then reverted, because the
   `icon: 'custom'` write was answered by a row still holding the old URL.
   */
  updateFields: (
    project: ProjectConfigItem,
    fields: Partial<ProjectConfigItem>,
  ) => Promise<boolean>;
  isAdding: boolean;
  addProject: (input: { name: string; path: string }) => Promise<void>;
  isDeleting: boolean;
  deleteProject: (project: ProjectConfigItem) => Promise<void>;
  onError: (message: string) => void;
}

const NO_SELECTION = '';

function isProject(value: unknown): value is ProjectConfigItem {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.path === 'string';
}

function isAccentOption(value: unknown): value is AccentColorOption {
  if (!isRecord(value)) return false;
  return typeof value.label === 'string' && typeof value.value === 'string' && typeof value.bgHex === 'string';
}

/** Merge a saved row back into the list; unknown ids are appended. */
function mergeProject(list: ProjectConfigItem[], saved: ProjectConfigItem): ProjectConfigItem[] {
  const known = list.some((row) => row.id === saved.id);
  return known ? list.map((row) => (row.id === saved.id ? saved : row)) : [...list, saved];
}

export function useProjectSettings(onError: (message: string) => void): ProjectSettingsState {
  const [projects, setProjects] = useState<ProjectConfigItem[]>([]);
  const [accentColorOptions, setAccentColorOptions] = useState<AccentColorOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>(NO_SELECTION);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const applyPayload = useCallback((data: unknown) => {
    if (!isRecord(data)) return;
    const rows = Array.isArray(data.projects) ? data.projects.filter(isProject) : null;
    if (rows) {
      setProjects(rows);
      setSelectedId((current) =>
        rows.some((row) => row.id === current) ? current : rows[0]?.id ?? NO_SELECTION,
      );
    }
    if (Array.isArray(data.accentColorOptions)) {
      setAccentColorOptions(data.accentColorOptions.filter(isAccentOption));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/projects');
      const data: unknown = await response.json();
      if (!response.ok) {
        const reason = isRecord(data) && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`;
        setLoadError(reason);
        return;
      }
      setLoadError(null);
      applyPayload(data);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [applyPayload]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await refresh();
      if (active) setIsLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [refresh]);

  // One signal for every writer of these rows (this pane, the sidebar menu,
  // another tab). Keyed on the folder facts the pane renders, so an unrelated
  // sidebar republish does not refetch.
  const sidebarFolders = useSidebarData().folders;
  const refreshKey = useMemo(
    () => sidebarFolders
      .map((folder) => `${folder.id}:${folder.name}:${folder.model ?? ''}:${folder.icon ?? ''}:${folder.accentColor ?? ''}:${folder.project_path ?? ''}:${folder.isPinned ? 1 : 0}`)
      .join('|'),
    [sidebarFolders],
  );
  useEffect(() => {
    if (!refreshKey) return;
    void refresh();
  }, [refreshKey, refresh]);

  /** One PATCH for a set of fields, with the row reverted if the server refuses. */
  const saveFields = useCallback(async (
    project: ProjectConfigItem,
    fields: Partial<ProjectConfigItem>,
  ): Promise<boolean> => {
    if (project.folderId === undefined) {
      onErrorRef.current('This project has no workspace row to save to.');
      return false;
    }
    const previous = projects;
    setProjects((current) => current.map((row) => (
      row.id === project.id ? { ...row, ...fields } : row
    )));
    // An explicit `undefined` is how the pane clears a field (the custom icon),
    // and the patch parser reads `null` as "unset".
    const wire: Record<string, unknown> = { folderId: project.folderId };
    for (const [key, value] of Object.entries(fields)) {
      wire[key] = value === undefined ? null : value;
    }
    try {
      const response = await fetch('/api/settings/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: wire }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const reason = isRecord(data) && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`;
        throw new Error(reason);
      }
      // The server's row is authoritative (trimmed name, expanded path). A
      // payload without one keeps the optimistic value rather than blanking it.
      const saved = isRecord(data) && isProject(data.project) ? data.project : null;
      if (saved) setProjects((current) => mergeProject(current, saved));
      return true;
    } catch (error) {
      setProjects(previous);
      onErrorRef.current(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [projects]);

  const updateField = useCallback(<K extends keyof ProjectConfigItem>(
    project: ProjectConfigItem,
    field: K,
    value: ProjectConfigItem[K],
  ): Promise<boolean> => saveFields(project, { [field]: value } as Partial<ProjectConfigItem>), [saveFields]);

  const updateFields = useCallback(
    (project: ProjectConfigItem, fields: Partial<ProjectConfigItem>): Promise<boolean> =>
      saveFields(project, fields),
    [saveFields],
  );

  const addProject = useCallback(async (input: { name: string; path: string }) => {
    setIsAdding(true);
    try {
      const response = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: input.name, path: input.path }),
      });
      const data: unknown = await response.json().catch(() => null);
      const folder = isRecord(data) ? data.folder : null;
      const createdId = isRecord(folder) && typeof folder.id === 'number' ? folder.id : null;
      if (!response.ok || !isRecord(data) || data.success !== true || createdId === null) {
        const reason = isRecord(data) && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`;
        throw new Error(reason);
      }
      await refresh();
      setSelectedId(`folder-${createdId}`);
    } catch (error) {
      onErrorRef.current(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setIsAdding(false);
    }
  }, [refresh]);

  const deleteProject = useCallback(async (project: ProjectConfigItem) => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/settings/projects?id=${encodeURIComponent(project.id)}`, {
        method: 'DELETE',
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(data) || data.success !== true) {
        const reason = isRecord(data) && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`;
        throw new Error(reason);
      }
      setProjects((current) => {
        const remaining = current.filter((row) => row.id !== project.id);
        setSelectedId((id) => (id === project.id ? remaining[0]?.id ?? NO_SELECTION : id));
        return remaining;
      });
    } catch (error) {
      onErrorRef.current(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setIsDeleting(false);
    }
  }, []);

  // One catalog subscription for the whole pane. A failed read leaves the
  // picker empty, which is the honest state: no model can be offered.
  const models = useModelsCatalog((data) => (
    Array.isArray(data.modelList) && data.modelList.length > 0
      ? data.modelList.map((entry) => ({ provider: entry.provider, id: entry.id, name: entry.name || entry.id }))
      : undefined
  )) ?? [];

  const selected = projects.find((row) => row.id === selectedId) ?? projects[0] ?? null;

  return {
    projects,
    selected,
    selectedId: selected?.id ?? NO_SELECTION,
    select: setSelectedId,
    accentColorOptions,
    models,
    isLoading,
    loadError,
    refresh,
    updateField,
    updateFields,
    isAdding,
    addProject,
    isDeleting,
    deleteProject,
    onError,
  };
}
