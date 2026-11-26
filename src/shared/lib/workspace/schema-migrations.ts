import type { DbClient } from '@kabmo-labs/kabmo-db/client';

async function addColumn(db: DbClient, statement: string): Promise<void> {
  try {
    await db.exec(statement);
  } catch (error) {
    return;
  }
}

export async function migrateWorkspaceFolderColumns(db: DbClient): Promise<void> {
  await addColumn(db, 'ALTER TABLE workspace_folders ADD COLUMN is_expanded BOOLEAN DEFAULT 0;');
  await addColumn(db, 'ALTER TABLE workspace_folders ADD COLUMN project_path TEXT;');
  await addColumn(db, 'ALTER TABLE workspace_folders ADD COLUMN is_pinned BOOLEAN DEFAULT 0;');
  await addColumn(db, "ALTER TABLE workspace_folders ADD COLUMN model TEXT DEFAULT 'Not selected';");
  await addColumn(db, "ALTER TABLE workspace_folders ADD COLUMN accent_color TEXT DEFAULT '';");
  await addColumn(db, "ALTER TABLE workspace_folders ADD COLUMN icon TEXT DEFAULT 'default';");
  await addColumn(db, 'ALTER TABLE workspace_folders ADD COLUMN custom_icon_url TEXT;');
}
