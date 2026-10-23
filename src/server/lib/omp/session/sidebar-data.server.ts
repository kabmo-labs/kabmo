/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single source of truth for the sidebar session list (folders + sessions +
 * live stream statuses). Shared by:
 *
 *   - GET /api/sessions/list — the client-side fetch endpoint the session
 *     sidebars refresh through (`useSidebarData`), skeleton-first.
 *   - Kept importable by any future consumer (mobile native, external poll).
 *
 * Previously this logic lived inline in the `routes/_index` loader; it moved
 * here when the folder list was decoupled from SSR (settings + mobile UA
 * stay server-rendered, the heavy omp JSONL scan is fetched client-side).
 */

import { getDb } from '@/server/db.server';
import { isMockMode } from '@/server/mock.server';
import { DEFAULT_SESSION_SORT_OPTION, isValidSessionSortOption, sortFolders } from '@/shared/lib/workspace/sidebar-sort';
import { groupSessionsByRoot, sessionTitleFor } from '@/shared/lib/omp/session/sidebar';
import { loadOmpSidebarData } from '@/server/lib/omp/session/reader';
import { sessionHasSubagents } from '@/server/lib/omp/session/subagent-presence';
import { loadStreamStates, type SessionRunModel } from '@/shared/lib/omp/session/stream-state.server';
import { healStaleStreamStatuses } from '@/shared/lib/omp/session/stream-heal.server';
import { getAwaitingInputSessionIds, getLiveRunSessionIds, listRpcSessions } from '@/server/lib/omp/rpc/session-registry';
import type { SessionItemData, SessionSortOption, WorkspaceFolderData } from '@/shared/types';
import { sessionWorktreeMap } from '@/server/lib/fs/worktree/topology';
import { canonicalPath } from '@/server/lib/fs/canonical';
import type { SessionWorktreeInfo } from '@/shared/lib/workspace/worktree/types';
import type { OmpSession } from '@/shared/types/omp/session';

/** What `GET /api/sessions/list` returns and sidebars consume. */
export interface SessionListPayload {
  folders: WorkspaceFolderData[];
  isMock: boolean;
}

/** workspace_folders row: only the columns the sidebar reads. */
interface FolderRow {
  id: number;
  name: string;
  project_path?: string | null;
  is_pinned?: number;
  is_expanded?: number;
  model?: string;
  accent_color?: string;
  icon?: string;
  custom_icon_url?: string;
}

/** archived_sessions row. */
interface ArchivedRow {
  session_id: string;
}

/** Mock-mode `sessions` table row (numeric ids), per the db.server seed. */
interface MockSessionRow extends SessionItemData {
  id: number;
  folder_id: number;
}

/**
 * The sidebar's STRUCTURE: folders, their sessions, and the sort order.
 *
 * Split from the volatile fields (see `loadSidebarStatus`) because the two have
 * wildly different costs and cadences: this runs a full omp JSONL discovery
 * scan, while the status is a single SQLite read plus the live process
 * registry. The realtime transport publishes them as separate topics so a
 * stream-status flip does not re-scan every session file.
 */
export async function loadSidebarStructure(): Promise<SessionListPayload> {
  const mock = isMockMode();
  const db = await getDb();
  const folderRows = (await db.all('SELECT * FROM workspace_folders ORDER BY id ASC')) as FolderRow[];

  const groupedFolders: WorkspaceFolderData[] = [];
  // Archive state lives in archived_sessions (session_id TEXT PK) so it works
  // for both numeric mock ids and omp session UUIDs in real mode.
  const archivedRows = (await db.all('SELECT session_id FROM archived_sessions')) as ArchivedRow[];
  const archivedIds = new Set(archivedRows.map((r) => String(r.session_id)));
  if (mock) {
    // Dynamic on purpose: this is demo data that lives under `client/`, and a
    // static import would pull it into the server graph (and every real-mode
    // boot) for a branch only MOCK mode takes.
    const { hasMockSubagents, getMockSubagents } = await import('@/client/data/mock/subagents');
    const sessions = (await db.all('SELECT * FROM sessions ORDER BY id ASC')) as MockSessionRow[];
    for (const folder of folderRows) {
      const folderSessions = sessions
        .filter((s) => String(s.folder_id) === String(folder.id))
        .map((s) => {
          const hasSub = hasMockSubagents(s.id);
          const subCount = getMockSubagents(s.id).length;
          return {
            ...s,
            is_archived: archivedIds.has(String(s.id)) ? 1 : 0,
            hasSubagents: hasSub,
            subagentCount: subCount,
          };
        });
      groupedFolders.push({
        id: folder.id,
        name: folder.name,
        project_path: folder.project_path ?? null,
        isPinned: folder.is_pinned === 1,
        isExpanded: folder.is_expanded === 1,
        model: folder.model || 'Not selected',
        accentColor: folder.accent_color || '',
        icon: folder.icon || 'default',
        customIconUrl: folder.custom_icon_url || undefined,
        sessions: folderSessions,
        hasMore: folderSessions.length > 7,
        totalSessions: folderSessions.length,
      });
    }
  } else {
    // Real mode: workspace folders are bound to omp projects via project_path;
    // the session items under each folder come from the omp JSONL discovery.
    groupedFolders.push(...(await buildRealFolders(folderRows, archivedIds)));
  }

  // Sidebar ordering is a server concern: the endpoint applies the persisted
  // preference so the payload already matches the client's render. Shipping
  // one order and re-sorting in the browser is what read as a flicker on load.
  const sidebarSort = await serverSidebarSort();

  return {
    folders: sortFolders(groupedFolders, sidebarSort),
    isMock: mock,
  };
}

/**
 * The sidebar's VOLATILE fields, keyed by session id: live stream status, the
 * model serving the run, and whether the session is blocked on a dialog.
 *
 * `repair` runs the two self-heal halves, because this is where a stale spinner
 * is actually looked at:
 *
 *   - a `stream` row whose owning Kabmo process is gone (judged from the row
 *     alone, so every instance agrees);
 *   - a `stream` row THIS process owns with no live run behind it — an orphan,
 *     which only this process can see (see `healStaleStreamStatuses`), plus a
 *     `get_state` reconcile for the rows this process owns.
 *
 * The realtime publisher passes `repair: false`: it runs on every stream-status
 * WRITE, and a write is already the truth for the run it describes. The repair
 * belongs to the subscribe-time snapshot, which is the moment the old sidebar
 * poll used to provide it.
 */
export async function loadSidebarStatus(
  options: { repair?: boolean } = {},
): Promise<Record<string, {
  streamStatus?: 'stream' | 'finish' | 'abort';
  awaitingInput?: boolean;
  runModel?: SessionRunModel;
}>> {
  // No MOCK short-circuit: the simulated stream writes the same `stream` row a
  // real run does (`routes/chat/stream.ts`), so the sidebar spinner and the
  // chat's generating indicator have one source in every mode. Returning `{}`
  // here is what kept the two from ever agreeing under `MOCK=true`.
  if (options.repair !== false) {
    // The database is shared by every Kabmo instance on the machine, so a
    // `stream` row may belong to a process this one cannot see. Ownership is
    // read from the row itself (its `owner_pid`) against OS liveness — never
    // against this process's own runtime registry, which would make two
    // instances report different statuses for the same run.
    //
    // The live-run set is passed for the OTHER half only: the rows this process
    // owns. It is deliberately not the staleness rule, which must stay
    // instance-independent.
    await healStaleStreamStatuses(getLiveRunSessionIds());
    // The heal judges a row from its owner pid alone; a row this process owns
    // while no run is behind it needs the OWNER's view of the child, which only
    // a `get_state` can give (see `run-settle.server.ts`). Fire-and-forget: the
    // list never waits on a probe, and the next read carries the settled status.
    for (const session of listRpcSessions()) void session.runSettle.reconcile('request');
  }

  const status: Record<string, {
    streamStatus?: 'stream' | 'finish' | 'abort';
    awaitingInput?: boolean;
    runModel?: SessionRunModel;
  }> = {};
  for (const [id, state] of Object.entries(await loadStreamStates())) {
    status[id] = { streamStatus: state.status, ...(state.model ? { runModel: state.model } : {}) };
  }
  // Sessions blocked on a dialog nobody has answered yet. Read live from the
  // process registry (never persisted): the child that owns the question is the
  // same thing that owns the flag, so a restart cannot leave a stale badge.
  for (const id of getAwaitingInputSessionIds()) {
    status[id] = { ...(status[id] ?? {}), awaitingInput: true };
  }
  return status;
}

/**
 * The two halves merged into one payload — what `GET /api/sessions/list`
 * answers and what the sidebar rendered before the realtime transport existed.
 */
export async function loadSidebarData(): Promise<SessionListPayload> {
  const [structure, status] = await Promise.all([loadSidebarStructure(), loadSidebarStatus()]);
  return {
    ...structure,
    folders: structure.folders.map((folder) => ({
      ...folder,
      sessions: (folder.sessions ?? []).map((session) => {
        const volatile = status[String(session.id)];
        return volatile ? { ...session, ...volatile } : session;
      }),
    })),
  };
}

/** Persisted sidebar sort preference (SQLite app_settings), defaulting to newest session activity. */
async function serverSidebarSort(): Promise<SessionSortOption> {
  try {
    const db = await getDb();
    const row = await db.get('SELECT value FROM app_settings WHERE key = ?', ['omp_sidebar_sort']);
    if (row && isValidSessionSortOption(row.value)) {
      return row.value;
    }
  } catch {
    // Table may not exist yet right after creation.
  }
  return DEFAULT_SESSION_SORT_OPTION;
}

/**
 * Real-mode folder assembly: run the omp discovery scan once and bucket the
 * discovered sessions under each folder whose project_path matches the
 * session's resolved project root. Folders without a project_path render with
 * no omp sessions (a local/empty workspace).
 */
async function buildRealFolders(folderRows: FolderRow[], archivedIds: Set<string>): Promise<WorkspaceFolderData[]> {
  const data = await loadOmpSidebarData();
  const sessionsByRoot = groupSessionsByRoot(data.sessions);

  return Promise.all(folderRows.map(async (folder) => {
    const root = folder.project_path ?? '';
    // The bucket key is CANONICAL: `resolveRootsByCwd` resolves each session's
    // cwd through `resolveProjectRoot`, which realpaths it, while a folder row
    // holds the spelling the user's path was registered under. On macOS those
    // differ for anything under `/var` (a symlink to `/private/var`), so a
    // project in a temp directory or under a symlinked home listed ZERO sessions
    // — measured: every real-mode session was missing from the sidebar, and the
    // worktree badge could never appear because the session was not even in the
    // folder it belongs to.
    const rootKey = root ? await canonicalPath(root) : '';
    const rootSessions: OmpSession[] = root
      ? (sessionsByRoot.get(rootKey) ?? sessionsByRoot.get(root) ?? [])
      : [];
    // One topology read per repository, however many sessions it has. A chat in
    // the checkout itself is absent from this map, which is exactly what the row
    // draws (an ordinary row with no badge).
    const worktrees = await sessionWorktreeMap(
      root,
      rootSessions.map((session) => ({ id: session.id, cwd: session.cwd })),
    );
    const folderSessions = await Promise.all(rootSessions.map(async (session: OmpSession) => {
      const hasSub = session.path
        ? await sessionHasSubagents(session.path, session.modified)
        : false;
      const worktree: SessionWorktreeInfo | undefined = worktrees.get(session.id);
      return {
        id: session.id,
        folder_id: folder.id,
        title: sessionTitleFor(session),
        created_at: session.created,
        updated_at: session.modified,
        is_active: 0,
        is_archived: archivedIds.has(String(session.id)) ? 1 : 0,
        hasSubagents: hasSub,
        // The session's own working directory, and the worktree it resolves to
        // when that cwd is a linked checkout. Both travel so no client and no
        // plugin has to ask git.
        cwd: session.cwd,
        ...(worktree ? { worktree } : {}),
      };
    }));
    return {
      id: folder.id,
      name: folder.name,
      project_path: folder.project_path ?? null,
      isPinned: folder.is_pinned === 1,
      isExpanded: folder.is_expanded === 1,
      model: folder.model || 'Not selected',
      accentColor: folder.accent_color || '',
      icon: folder.icon || 'default',
      customIconUrl: folder.custom_icon_url || undefined,
      sessions: folderSessions,
      hasMore: folderSessions.length > 7,
      totalSessions: folderSessions.length,
    };
  }));
}
