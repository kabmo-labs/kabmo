/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Adapter from oh-my-pi discovery data to Kabmo folder model.
 *
 * Folders are the SQLite-managed workspaces (id, name, isExpanded,
 * project_path). This module produces the *session items* that fill those
 * folders from the omp JSONL scan, and mirrors omp's project ordering so the
 * folders list can be seeded/refreshed consistently.
 *
 * Session items carry the omp session UUID as their id — a session belongs to
 * the folder whose project_path equals its resolved project root.
 */

import type { OmpProject, OmpSession, OmpSidebarData } from '@/shared/types/omp/session';
import { formatNewSessionTitle } from '@/shared/lib/omp/session/default-title';

/**
 * Display title of a chat, from the two things that can name it.
 *
 * ONE rule for both row sources: an omp session (whose JSONL carries `name` and
 * `firstMessage`) and a recorded ACP chat (whose agent writes no session file, so
 * Kabmo stores those same facts in `harness_sessions`). Two copies of this
 * precedence is how one row source starts saying `Untitled` where the other says
 * the first prompt.
 */
export function deriveSessionTitle(parts: {
  /** The chat's own name: omp's JSONL title slot, or an ACP agent's own
   *  `session_info_update`. */
  name?: string | null;
  /** The first user message, used only when no name exists. */
  firstMessage?: string | null;
  /**
   * The chat's creation stamp, for the title a nameless chat is drawn with.
   * Either shape the two row sources hold: an omp session carries an ISO
   * string, a `harness_sessions` row an epoch in milliseconds.
   */
  created: number | string;
}): string {
  const name = parts.name?.trim();
  if (name) return name.charAt(0).toUpperCase() + name.slice(1);
  const first = (parts.firstMessage || '').trim();
  if (first && first !== '(no messages)') {
    const text = first.slice(0, 120);
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  return formatNewSessionTitle(new Date(parts.created));
}

/** Display title of a session: name, else first message, else a timestamped
 *  `New Session - yyyy-mm-ddThh:mm:ss` default (unique per session — an
 *  identical placeholder row made fresh sessions indistinguishable). */
export function sessionTitleFor(session: OmpSession): string {
  return deriveSessionTitle({
    name: session.name,
    firstMessage: session.firstMessage,
    created: session.created,
  });
}

/** Project display name: alias, else lowercase basename of the path. */
export function projectDisplayName(project: OmpProject): string {
  if (project.alias?.trim()) return project.alias.trim();
  const trimmed = project.path.replace(/[\\/]+$/, '');
  const base = trimmed.split(/[\\/]/).pop() || project.path;
  return (base || project.path).toLowerCase();
}

/** Omp-side ordering of projects: sortOrder, then addedAt desc. */
export function compareOmpProjects(a: OmpProject, b: OmpProject): number {
  const aOrder = a.sortOrder ?? Number.POSITIVE_INFINITY;
  const bOrder = b.sortOrder ?? Number.POSITIVE_INFINITY;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return (b.addedAt ?? '').localeCompare(a.addedAt ?? '');
}

/** Map sessions into per-project-root buckets (newest-modified first). */
export function groupSessionsByRoot(sessions: OmpSession[]): Map<string, OmpSession[]> {
  const byRoot = new Map<string, OmpSession[]>();
  for (const session of sessions) {
    const root = session.projectRoot || session.cwd || '';
    const bucket = byRoot.get(root);
    if (bucket) bucket.push(session);
    else byRoot.set(root, [session]);
  }
  for (const bucket of byRoot.values()) {
    bucket.sort((a, b) => b.modified.localeCompare(a.modified));
  }
  return byRoot;
}

/**
 * Build the ordered project list used to seed workspace folders:
 * registered projects (sortOrder/addedAt) first, then discovered extras
 * (path-sorted) — mirroring omp-web's mergeProjects ordering.
 */
export function orderedOmpProjects(data: OmpSidebarData): OmpProject[] {
  const registered = data.projects.filter((p) => !p.discovered).sort(compareOmpProjects);
  const discovered = data.projects.filter((p) => p.discovered).sort((a, b) => a.path.localeCompare(b.path));
  return [...registered, ...discovered];
}
