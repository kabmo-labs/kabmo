/**
 * @license
 * SPDX-License-Identifier: MIT
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
import { loadStreamStates } from '@/shared/lib/omp/session/stream-state.server';
import { healStaleStreamStatuses } from '@/shared/lib/omp/session/stream-heal.server';
import { getAwaitingInputSessionIds, getLiveRunSessionIds, listRpcSessions } from '@/server/lib/omp/rpc/session-registry';
import type { SessionItemData, SessionSortOption, WorkspaceFolderData } from '@/shared/types';
import type { SidebarStatusEntry } from '@/shared/types/realtime';
import { sessionWorktreeMap } from '@/server/lib/fs/worktree/topology';
import { DEFAULT_HARNESS_ID, HARNESS_IDS } from '@/shared/lib/harness/catalog';
import { knownHarness, loadAcpSessions, loadHarnessBySession } from '@/server/lib/harness/session-store.server';
import { canonicalPath } from '@/server/lib/fs/canonical';
import { acpRowsFor } from '@/server/lib/omp/session/acp-rows.server';
import { decorateSidebarSessions } from '@/server/lib/sessions/sidebar-relations.server';
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
/** One session's volatile sidebar fields, as the status topic carries them. */
export async function loadSidebarStatus(
  options: { repair?: boolean } = {},
): Promise<Record<string, SidebarStatusEntry>> {
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

  const status: Record<string, SidebarStatusEntry> = {};
  for (const [id, state] of Object.entries(await loadStreamStates())) {
    status[id] = {
      streamStatus: state.status,
      ...(state.model ? { runModel: state.model } : {}),
      ...(state.failure ? { runFailure: state.failure } : {}),
      ...(state.startedAt !== undefined ? { runStartedAt: state.startedAt } : {}),
    };
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
  // WHICH HARNESS OWNS EACH SESSION, read once for the whole list. The live
  // registry cannot answer this: it is a `WeakMap` on the session objects of
  // THIS process, so a restart, a closed tab or a second instance loses it — and
  // that is why every row used to be reported as `omp`. This table is written at
  // spawn and outlives all three.
  let harnessBySession: Map<string, string>;
  let acpSessions: Awaited<ReturnType<typeof loadAcpSessions>>;
  try {
    [harnessBySession, acpSessions] = await Promise.all([loadHarnessBySession(), loadAcpSessions()]);
  } catch {
    // A database without the table yet (an older file opened before this
    // migration ran). Every row then falls back to the omp default below, which
    // is what a reader saw before — never an error page over the whole sidebar.
    harnessBySession = new Map();
    acpSessions = [];
  }

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
        // WHICH AGENT PRODUCED THIS CHAT, from the persisted record. A session
        // discovered in omp's JSONL store with no row is an omp one by
        // construction (that is where omp writes), and `DEFAULT_HARNESS_ID` is
        // then the truth rather than a guess. A session spawned over ACP has its
        // own row, so the mark beside its name names the agent that ran it —
        // reporting `omp` for every row made the mark decorative.
        harness: knownHarness(harnessBySession.get(String(session.id)), HARNESS_IDS) ?? DEFAULT_HARNESS_ID,
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
    // ACP chats live ONLY here: their agent writes no session file, so omp's
    // discovery cannot see them and a chat vanished from the sidebar the moment
    // its tab closed. They are filed under the folder whose PROJECT contains
    // their cwd, resolved the same way the discovery scan resolves it — a chat
    // started in a subdirectory belongs to the folder that owns it, not to none.
    const folderAcp = rootKey
      ? await acpRowsFor(acpSessions, rootKey, folder.id, archivedIds)
      : [];
    // ONE CHAT, ONE ROW. The two producers overlap whenever the agent writes a
    // session file AND has a `harness_sessions` record, and that is not a
    // corner case: `omp-acp` launches `omp acp`, so its chats are ordinary
    // `.jsonl` files discovery finds — measured, an `omp (ACP)` chat appeared
    // TWICE in the sidebar under the same id, one row from the scan and one
    // from the record. The scan's row is authoritative (it carries the real
    // title, timestamps and subagent state), so a recorded row whose id the
    // scan already listed is dropped rather than replaced.
    const discoveredIds = new Set(folderSessions.map((session) => String(session.id)));
    const uniqueAcp = folderAcp.filter((row) => !discoveredIds.has(String(row.id)));
    // MERGED, then ordered as ONE list. Appending the ACP rows after omp's
    // already-sorted bucket put them at the bottom of a 240-row folder, which is
    // why a chat just spawned on `opencode2` never appeared above "Show more".
    // The scan's own rule is `b.modified.localeCompare(a.modified)`
    // (`groupSessionsByRoot`), so this uses the same key rather than a second
    // definition of "newest".
    const allSessions = [...folderSessions, ...uniqueAcp].sort((a, b) => (b.updated_at ?? b.created_at ?? '').localeCompare(a.updated_at ?? a.created_at ?? ''));
    const visibleSessions = await decorateSidebarSessions(allSessions);
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
      sessions: visibleSessions,
      hasMore: visibleSessions.length > 7,
      totalSessions: visibleSessions.length,
    };
  }));
}
