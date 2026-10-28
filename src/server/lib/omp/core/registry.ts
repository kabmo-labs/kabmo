/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Read-only port of omp-web's managed-project registry
 * (omp-web/lib/project-registry.ts) — enough to reproduce how the omp-web
 * sidebar composes its workspace list:
 *
 *   1. read ~/.omp/agent/projects.json (registered projects with alias /
 *      sortOrder / hidden presentation state),
 *   2. discover every project that has sessions on disk
 *      (session-discovered projects, e.g. before omp-web registered them),
 *   3. merge: registered first (sortOrder, then most-recently-added), hidden
 *      entries excluded, discovered extras follow sorted by path.
 *
 * Kabmo only READS this file — it never writes the agent's registry.
 */

import { canonicalize, getProjectsRegistryPath } from '@/server/lib/omp/core/paths';
import type { OmpProject } from '@/shared/types/omp/session';

/** Error carrying a stable code (errors.* key) for client localization. */
export class ProjectPathError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProjectPathError';
    this.code = code;
  }
}

export interface OmpProjectRegistryEntry {
  /** Canonical project path (worktrees resolve to their main repo root). */
  path: string;
  /** ISO timestamp of the most recent explicit add. */
  addedAt?: string;
  /** True when the user removed the project from the sidebar. Hidden entries
   *  suppress session re-discovery until the project is added again. */
  hidden?: boolean;
  /** Optional display-only workspace name. */
  alias?: string;
  /** Explicit sidebar position; lower values appear first. */
  sortOrder?: number;
}

export interface OmpProjectRegistryFile {
  version: 1;
  projects: OmpProjectRegistryEntry[];
}

const EMPTY_REGISTRY: OmpProjectRegistryFile = { version: 1, projects: [] };

function comparableProjectPath(value: string): string {
  let normalized = value.replace(/\\/g, '/');
  const windowsForm = /^[a-zA-Z]:[\\/]/.test(normalized) || /^\/\//.test(normalized);
  normalized = normalized.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return windowsForm ? normalized.toLowerCase() : normalized;
}

/** Parse registry JSON; missing, corrupt, or foreign-shaped input yields an
 *  empty registry rather than failing the whole sidebar. */
export function parseProjectRegistry(raw: string): OmpProjectRegistryFile {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_REGISTRY;
    if (!('projects' in parsed) || !Array.isArray(parsed.projects)) return EMPTY_REGISTRY;
    const entries: OmpProjectRegistryEntry[] = [];
    for (const item of parsed.projects) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      if (!('path' in item) || typeof item.path !== 'string' || !item.path.trim()) continue;
      const record = item as Record<string, unknown>;
      entries.push({
        path: canonicalize(record.path as string),
        addedAt: typeof record.addedAt === 'string' ? record.addedAt : undefined,
        hidden: record.hidden === true,
        alias: typeof record.alias === 'string' && record.alias.trim() ? record.alias.trim() : undefined,
        sortOrder:
          typeof record.sortOrder === 'number' && Number.isFinite(record.sortOrder) ? record.sortOrder : undefined,
      });
    }
    return { version: 1, projects: entries };
  } catch {
    return EMPTY_REGISTRY;
  }
}

/** Load ~/.omp/agent/projects.json (missing/corrupt → empty registry). */
export async function loadProjectRegistry(registryPath: string = getProjectsRegistryPath()): Promise<OmpProjectRegistryFile> {
  if (!(await Bun.file(registryPath).exists())) return EMPTY_REGISTRY;
  try {
    return parseProjectRegistry(await Bun.file(registryPath).text());
  } catch {
    return EMPTY_REGISTRY;
  }
}

/**
 * Merge registered projects with session-discovered ones, excluding hidden
 * entries. Registered projects come first in most-recently-added order (or
 * explicit sortOrder); discovered projects follow sorted by path.
 */
export function mergeProjects(registry: OmpProjectRegistryFile, discovered: Iterable<string>): OmpProject[] {
  const hidden = new Set(
    registry.projects.filter((p) => p.hidden).map((p) => comparableProjectPath(p.path)),
  );
  const registered: OmpProject[] = [];
  const registeredSeen = new Set<string>();
  for (const p of registry.projects
    .filter((entry) => !entry.hidden)
    .sort((a, b) => {
      const aOrder = a.sortOrder ?? Number.POSITIVE_INFINITY;
      const bOrder = b.sortOrder ?? Number.POSITIVE_INFINITY;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (b.addedAt ?? '').localeCompare(a.addedAt ?? '');
    })) {
    const key = comparableProjectPath(p.path);
    if (registeredSeen.has(key)) continue; // tolerate hand-edited duplicates
    registeredSeen.add(key);
    registered.push({
      path: p.path,
      addedAt: p.addedAt,
      alias: p.alias,
      sortOrder: p.sortOrder,
      discovered: false,
    });
  }

  const extra: OmpProject[] = [];
  const extraSeen = new Set<string>();
  for (const raw of new Set([...discovered].filter(Boolean).map(canonicalize))) {
    const key = comparableProjectPath(raw);
    if (hidden.has(key) || registeredSeen.has(key) || extraSeen.has(key)) continue;
    extraSeen.add(key);
    extra.push({ path: raw, discovered: true });
  }
  extra.sort((a, b) => a.path.localeCompare(b.path));
  return [...registered, ...extra];
}
