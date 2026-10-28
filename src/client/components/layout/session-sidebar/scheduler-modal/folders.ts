/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The workspace folders a scheduled task can run in, as NUMERIC folder ids.
 *
 * Deliberately not `useWorkspaceRoots`: that hook exposes each folder's project
 * PATH as the option id (which is what the skills/commands panels scope by),
 * while a task stores the folder's row id and resolves the path server-side at
 * write time. Reusing it here would mean parsing `folder-<n>` back out of a
 * string, and a folder renamed after the task was created would then keep a
 * stale path the user cannot see or fix.
 */

import { useEffect, useState } from 'preact/hooks';

export interface ScheduleFolderOption {
  id: number;
  name: string;
}

interface ProjectConfigItem {
  folderId?: number;
  name: string;
  path?: string;
}

export function useScheduleFolders(): ScheduleFolderOption[] {
  const [folders, setFolders] = useState<ScheduleFolderOption[]>([]);

  useEffect(() => {
    let active = true;
    fetch('/api/settings/projects')
      .then((res) => res.json())
      .then((data: { projects?: ProjectConfigItem[] }) => {
        if (!active) return;
        setFolders(
          (data.projects ?? [])
            .filter((project) => typeof project.folderId === 'number')
            .map((project) => ({ id: project.folderId as number, name: project.name })),
        );
      })
      .catch((error) => console.error('Failed to load workspace folders:', error));
    return () => {
      active = false;
    };
  }, []);

  return folders;
}
