import type { DbClient } from '@kabmo-labs/kabmo-db/client';
import { DEFAULT_PROJECTS_LIST } from '@/client/data/settings/project';

const MIGRATION_KEY = 'omp_projects_config_migrated';

interface LegacyProject {
  name?: unknown;
  path?: unknown;
  model?: unknown;
  accentColor?: unknown;
  icon?: unknown;
  customIconUrl?: unknown;
}

function isLegacyProject(value: unknown): value is LegacyProject {
  return typeof value === 'object' && value !== null;
}

export async function migrateLegacyProjectSettings(db: DbClient): Promise<void> {
  const marker = await db.get('SELECT value FROM app_settings WHERE key = ?', [MIGRATION_KEY]);
  if (marker?.value === '1') return;

  const legacyRow = await db.get('SELECT value FROM app_settings WHERE key = ?', ['omp_projects_config']);
  if (!legacyRow?.value) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(legacyRow.value);
  } catch (error) {
    return;
  }

  const legacyProjects = Array.isArray(parsed)
    ? parsed.filter(isLegacyProject)
    : DEFAULT_PROJECTS_LIST;
  const folders = await db.all('SELECT id, name, project_path FROM workspace_folders');

  for (const project of legacyProjects) {
    const name = typeof project.name === 'string' ? project.name : '';
    const path = typeof project.path === 'string' ? project.path : '';
    const folder = folders.find((candidate) =>
      (path && candidate.project_path === path) ||
      (name && candidate.name.toLowerCase() === name.toLowerCase()),
    );
    if (!folder) continue;

    await db.run(
      `UPDATE workspace_folders
       SET model = ?, accent_color = ?, icon = ?, custom_icon_url = ?
       WHERE id = ?`,
      [
        typeof project.model === 'string' ? project.model : 'Not selected',
        typeof project.accentColor === 'string' ? project.accentColor : '',
        typeof project.icon === 'string' ? project.icon : 'default',
        typeof project.customIconUrl === 'string' ? project.customIconUrl : null,
        folder.id,
      ],
    );
  }

  await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [MIGRATION_KEY, '1']);
}
