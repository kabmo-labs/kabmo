/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Read-only orchestrator over the oh-my-pi agent directory — the Kabmo
 * analog of omp-web's lib/session-reader.ts sidebar data path.
 *
 * Composes the pieces of the omp-web sidebar data source so a future UI fork
 * can consume "which workspaces exist and which sessions live under them"
 * without touching omp-web or oh-my-pi:
 *
 *   - session file scan          → lib/omp/session-files.ts
 *   - cwd → repository root      → lib/omp/worktree.ts
 *   - managed projects registry  → lib/omp/project-registry.ts
 *
 * All reads are bounded (a 4 KiB prefix plus a 16 KiB tail window per session
 * file), cached by file mtime, and never mutate the agent's files.
 */

import { listAllSessionInfos, type OmpSessionInfo } from '@/server/lib/omp/session/files';
import { loadProjectRegistry, mergeProjects } from '@/server/lib/omp/core/registry';
import { resolveProjectRoot } from '@/server/lib/omp/core/worktree';
import { getAgentDir, getSessionsDir, pathExists } from '@/server/lib/omp/core/paths';
import { SIDEBAR_DATA_TTL_MS } from '@/shared/lib/workspace/refresh-cadence';
import type { OmpProject, OmpSession, OmpSidebarData } from '@/shared/types/omp/session';

const CONCURRENCY = 6;

declare global {
  // eslint-disable-next-line no-var
  var __ompChamberSidebarDataCache: {
    data: OmpSidebarData;
    expiresAt: number;
    inFlight: Promise<OmpSidebarData> | null;
  } | undefined;
}

/**
 * Per-process TTL cache for the sidebar dataset. The loader revalidates on
 * every stream event; deduplicating concurrent requests and re-serving a
 * snapshot for a few seconds turns a burst of revalidations into one disk scan
 * (4 KiB prefix per session file) instead of one scan each.
 */
export async function loadOmpSidebarData(): Promise<OmpSidebarData> {
  let slot = globalThis.__ompChamberSidebarDataCache;
  if (!slot) {
    slot = { data: undefined as unknown as OmpSidebarData, expiresAt: 0, inFlight: null };
    globalThis.__ompChamberSidebarDataCache = slot;
  }
  const now = Date.now();
  if (slot.data && slot.expiresAt > now) return slot.data;
  if (slot.inFlight) return slot.inFlight;

  slot.inFlight = buildOmpSidebarData().finally(() => {
    if (slot && slot.inFlight) slot.inFlight = null;
  });
  return slot.inFlight;
}

/**
 * Drop the cached dataset so the next load re-scans disk. For a mutation the
 * TTL cannot see: deleting a session removes a row rather than changing one, so
 * nothing in the cached snapshot is stale — it is simply wrong, and the refresh
 * that follows the delete would otherwise serve it back for up to the TTL.
 */
export function invalidateOmpSidebarData(): void {
  const slot = globalThis.__ompChamberSidebarDataCache;
  if (!slot) return;
  slot.data = undefined as unknown as OmpSidebarData;
  slot.expiresAt = 0;
}

/** Resolve each unique cwd to its project root; bounded concurrency so 100+
 *  unique cwds don't spawn 100 parallel git processes. */
async function resolveRootsByCwd(cwds: string[]): Promise<Map<string, string>> {
  const projectByCwd = new Map<string, string>();
  for (let i = 0; i < cwds.length; i += CONCURRENCY) {
    const chunk = cwds.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (cwd) => {
        projectByCwd.set(cwd, await resolveProjectRoot(cwd));
      }),
    );
  }
  return projectByCwd;
}

/** Map a scanned session file to the sidebar session shape. */
function toOmpSession(
  info: OmpSessionInfo,
  projectRootByCwd: Map<string, string>,
): OmpSession {
  const projectRoot = info.cwd ? projectRootByCwd.get(info.cwd) : undefined;
  return {
    path: info.path,
    id: info.id,
    cwd: info.cwd,
    name: info.title,
    created: info.created.toISOString(),
    modified: info.modified.toISOString(),
    messageCount: info.messageCount,
    firstMessage: info.firstMessage,
    ...(info.parentSessionPath ? { parentSessionId: info.parentSessionPath } : {}),
    projectRoot,
  };
}

/** Workspaces that own at least one session file on disk (session-discovered). */
function discoveredProjectPaths(sessions: OmpSessionInfo[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const session of sessions) {
    if (!session.cwd) continue;
    if (seen.has(session.cwd)) continue;
    seen.add(session.cwd);
    out.push(session.cwd);
  }
  return out;
}

/**
 * Build the complete sidebar dataset in omp-web's shape:
 * registered + discovered projects, plus every session (newest first).
 */
async function buildOmpSidebarData(): Promise<OmpSidebarData> {
  const agentDir = getAgentDir();
  const sessionsDir = getSessionsDir();
  const available = await pathExists(sessionsDir);

  const ompSessions = await listAllSessionInfos(sessionsDir);
  const projectRootByCwd = await resolveRootsByCwd(
    [...new Set(ompSessions.map((s) => s.cwd).filter(Boolean))],
  );

  const registry = await loadProjectRegistry();
  const projects = mergeProjects(registry, discoveredProjectPaths(ompSessions));
  const sessions = ompSessions.map((info) => toOmpSession(info, projectRootByCwd));

  const data: OmpSidebarData = {
    projects,
    sessions,
    agentDir,
    available,
    generatedAt: new Date().toISOString(),
  };
  const slot = globalThis.__ompChamberSidebarDataCache;
  if (slot) {
    slot.data = data;
    slot.expiresAt = Date.now() + SIDEBAR_DATA_TTL_MS;
  }
  return data;
}

/** Convenience: only the project list (cheap — no per-session git lookups). */
export async function loadOmpProjects(): Promise<OmpProject[]> {
  const sessionsDir = getSessionsDir();
  const ompSessions = (await pathExists(sessionsDir)) ? await listAllSessionInfos(sessionsDir) : [];
  const registry = await loadProjectRegistry();
  return mergeProjects(registry, discoveredProjectPaths(ompSessions));
}
