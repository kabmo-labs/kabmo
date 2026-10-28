/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';
import type { ProjectOption } from '@/client/components/settings/ProjectSelectorDropdown';

interface ProjectConfigItem {
  id: string;
  name: string;
  path?: string;
}

export interface WorkspaceRoots {
  options: ProjectOption[];
  /** Workspace root for a selected option id, or null for the user scope. */
  rootFor: (optionId: string) => string | null;
  /** Query string (with leading `?`) for a read scoped to this option. */
  queryFor: (optionId: string) => string;
  /** Extra body fields scoping a write to this option. */
  scopeBodyFor: (optionId: string) => { root?: string; scope?: string };
  /** True when this option is a real workspace (the project scope exists). */
  isWorkspace: (optionId: string) => boolean;
}

/** Option id for the user-level (no workspace) scope. */
export const GLOBAL_SCOPE_ID = 'global';

const USER_OPTION: ProjectOption = {
  id: GLOBAL_SCOPE_ID,
  name: 'global',
  label: 'User (all projects)',
  value: '',
};

/**
 * The workspace folders the skills/commands panels can be scoped to.
 *
 * These are the real registered folders (`/api/settings/projects`), not the
 * hardcoded placeholder list the panels used to offer: a panel scoped to a
 * made-up project name sent a root the server could not resolve, so the picker
 * silently did nothing. The `value` of each option is the folder's project
 * path, which is what the API takes as `?root=`.
 *
 * The USER scope is `?scope=user` rather than "no root": omp resolves
 * project-scope skills and commands from its process cwd, so an unscoped read
 * answered for whatever directory the server happened to run in. `scope=user`
 * pins that read to the agent dir, which is the only cwd whose inventory is
 * the user's own.
 */
export function useWorkspaceRoots(): WorkspaceRoots {
  const [options, setOptions] = useState<ProjectOption[]>([USER_OPTION]);

  useEffect(() => {
    let active = true;
    fetch('/api/settings/projects')
      .then((res) => res.json())
      .then((data: { projects?: ProjectConfigItem[] }) => {
        if (!active) return;
        const folders = (data.projects ?? [])
          .filter((project) => typeof project.path === 'string' && project.path)
          .map((project) => ({
            id: project.id,
            name: project.name,
            label: project.name,
            value: project.path as string,
          }));
        setOptions([...folders, USER_OPTION]);
      })
      .catch((error) => console.error('Failed to load workspace folders:', error));
    return () => {
      active = false;
    };
  }, []);

  // The dropdown reports the option's VALUE (a project path) while a panel may
  // hold either that or the option id, so both resolve to the same root. An
  // id-only lookup silently answered the user scope for every workspace.
  const rootFor = (optionId: string): string | null => {
    const option = options.find((candidate) => candidate.id === optionId || candidate.value === optionId);
    const value = option?.value ?? '';
    return value || null;
  };

  const queryFor = (optionId: string): string => {
    const root = rootFor(optionId);
    return root ? `?root=${encodeURIComponent(root)}` : '?scope=user';
  };

  const scopeBodyFor = (optionId: string): { root?: string; scope?: string } => {
    const root = rootFor(optionId);
    return root ? { root } : { scope: 'user' };
  };

  const isWorkspace = (optionId: string): boolean => rootFor(optionId) !== null;

  return { options, rootFor, queryFor, scopeBodyFor, isWorkspace };
}
