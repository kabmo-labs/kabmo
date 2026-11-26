import type { DbClient } from '@kabmo-labs/kabmo-db/client';
import type { ProjectConfigItem } from '@/shared/types';
import { isRecord } from '@kabmo-labs/kabmo-guards';

export interface WorkspaceFolderRow {
  id: number;
  name: string;
  project_path?: string | null;
  model?: string | null;
  accent_color?: string | null;
  icon?: string | null;
  custom_icon_url?: string | null;
  is_pinned?: number | null;
  is_expanded?: number | null;
}

export interface FolderSettingsPatch {
  name?: string;
  projectPath?: string | null;
  model?: string;
  accentColor?: string;
  icon?: string;
  customIconUrl?: string | null;
  isPinned?: boolean;
  isExpanded?: boolean;
}

export function projectConfigFromFolder(folder: WorkspaceFolderRow): ProjectConfigItem {
  return {
    id: `folder-${folder.id}`,
    folderId: folder.id,
    name: folder.name,
    path: folder.project_path ?? '',
    model: folder.model || 'Not selected',
    accentColor: folder.accent_color || '',
    icon: folder.icon || 'default',
    customIconUrl: folder.custom_icon_url || undefined,
    isPinned: folder.is_pinned === 1,
    isExpanded: folder.is_expanded === 1,
  };
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export function parseFolderSettingsPatch(value: unknown): FolderSettingsPatch {
  if (!isRecord(value)) return {};

  const patch: FolderSettingsPatch = {};
  if (typeof value.name === 'string') patch.name = value.name.trim();
  if (typeof value.projectPath === 'string') patch.projectPath = value.projectPath.trim() || null;
  if (typeof value.model === 'string') patch.model = value.model;
  if (typeof value.accentColor === 'string') patch.accentColor = value.accentColor;
  if (typeof value.icon === 'string') patch.icon = value.icon;
  if (typeof value.customIconUrl === 'string') patch.customIconUrl = value.customIconUrl;
  if (value.customIconUrl === null) patch.customIconUrl = null;

  const isPinned = readBoolean(value.isPinned);
  if (isPinned !== undefined) patch.isPinned = isPinned;
  const isExpanded = readBoolean(value.isExpanded);
  if (isExpanded !== undefined) patch.isExpanded = isExpanded;

  return patch;
}

export async function updateWorkspaceFolder(
  db: DbClient,
  folderId: string,
  patch: FolderSettingsPatch,
): Promise<boolean> {
  const assignments: string[] = [];
  const values: Array<string | number | null> = [];

  if (patch.name !== undefined && patch.name !== '') {
    assignments.push('name = ?');
    values.push(patch.name);
  }
  if (patch.projectPath !== undefined) {
    assignments.push('project_path = ?');
    values.push(patch.projectPath);
  }
  if (patch.model !== undefined) {
    assignments.push('model = ?');
    values.push(patch.model);
  }
  if (patch.accentColor !== undefined) {
    assignments.push('accent_color = ?');
    values.push(patch.accentColor);
  }
  if (patch.icon !== undefined) {
    assignments.push('icon = ?');
    values.push(patch.icon);
  }
  if (patch.customIconUrl !== undefined) {
    assignments.push('custom_icon_url = ?');
    values.push(patch.customIconUrl);
  }
  if (patch.isPinned !== undefined) {
    assignments.push('is_pinned = ?');
    values.push(patch.isPinned ? 1 : 0);
  }
  if (patch.isExpanded !== undefined) {
    assignments.push('is_expanded = ?');
    values.push(patch.isExpanded ? 1 : 0);
  }

  if (assignments.length === 0) return false;

  values.push(folderId);
  const result = await db.run(
    `UPDATE workspace_folders SET ${assignments.join(', ')} WHERE id = ?`,
    values,
  );
  return Boolean(result.changes);
}

export async function deleteWorkspaceFolder(db: DbClient, folderId: string): Promise<boolean> {
  const folder = await db.get('SELECT id, project_path FROM workspace_folders WHERE id = ?', [folderId]);
  if (!folder) return false;

  if (folder.project_path) {
    await db.run(
      'INSERT OR REPLACE INTO deleted_workspaces (project_path) VALUES (?)',
      [folder.project_path],
    );
  }

  const sessionRows = await db.all('SELECT id FROM sessions WHERE folder_id = ?', [folderId]);
  for (const session of sessionRows) {
    await db.run('DELETE FROM files WHERE session_id = ?', [session.id]);
  }
  await db.run('DELETE FROM sessions WHERE folder_id = ?', [folderId]);
  await db.run('DELETE FROM workspace_folders WHERE id = ?', [folderId]);
  return true;
}
