/**
 * Session item shape. In real (non-mock) mode sessions come from oh-my-pi
 * JSONL discovery and use the omp session UUID (string) as id — hence the
 * union with string ids. Mock/demo mode keeps numeric SQLite ids.
 */
import type { SessionWorktreeInfo } from '@/shared/lib/workspace/worktree/types';

export interface SessionItemData {
  id: number | string;
  folder_id: number | string;
  title: string;
  created_at?: string;
  updated_at?: string;
  is_archived?: number;
  /** MOCK's `sessions` table column, carried through by the sidebar loader. Real
   *  mode writes `0` for every row (the opened session is the URL's), so the
   *  rows and the pagination read it only as a fallback for a mock install. */
  is_active?: number;
  timeAgo?: string;
  hasArrow?: boolean;
  hasSubagents?: boolean;
  subagentCount?: number;
  /** The session's parent in the sidebar tree. A fork has no parent. */
  parentSessionId?: string;
  /** Direct children; the client uses it to decide whether to draw a chevron. */
  childSessionCount?: number;
  /** Server-tracked stream state: `stream` while a run is in flight, then a
   *  one-shot `finish`/`abort` badge cleared when the session opens. */
  streamStatus?: 'stream' | 'finish' | 'abort';
  /** Live-only: the session's omp process is BLOCKED on an ask/approval dialog
   *  waiting for a user answer. Derived from the running process registry, never
   *  persisted — the process it describes is the same thing that owns the flag. */
  awaitingInput?: boolean;
  /** Set on a terminal `finish` row whose run ended in failure, with the
   *  agent's own reason when it reported one. Rides the status topic beside
   *  `streamStatus` so a background tab can announce the failure. */
  runFailure?: string;
  /** Model serving the session's current run — persisted beside `streamStatus`
   *  (session_stream_state) so the generating indicator names the real
   *  provider/model in every tab and Kabmo instances. Absent for a session
   *  with no run row; callers fall back to the transcript's model entry. */
  runModel?: { provider: string; modelId: string };
  /** Epoch ms this session's LIVE run entered `stream`, persisted beside
   *  `streamStatus`. The row's elapsed clock counts from here, so a reload or
   *  a second tab resumes the same count. Absent on terminal badges and on
   *  rows whose run predates the column. */
  runStartedAt?: number;
  /**
   * Set on a PENDING row whose prompt is held until another session finishes.
   *
   * The row has no transcript and no omp id yet — it exists because the user
   * sent a prompt that is deferred, and the cue is the only thing on screen
   * saying so. Absent means the row is not waiting (the normal case).
   */
  waitingFor?: { waitId: string; sessionId: string; title: string | null };
  /**
   * The directory the session actually runs in. A worktree session's cwd is the
   * linked checkout, not the folder's `project_path` — the difference the panels
   * have to honour and the sidebar badge names.
   */
  cwd?: string;
  /**
   * Which harness ran (and would resume) this session: `omp-rpc`, `claude`,
   * `codex`, … Absent for a session created before harnesses were tracked and
   * for a MOCK row, which no real agent owns — the row then draws no badge
   * rather than a fabricated one.
   *
   * A spawn-time fact, not a display preference: the value decides the
   * transport, the capabilities each panel can show, and the launch command.
   */
  harness?: string;
  /**
   * The worktree this session runs in, when its cwd is a linked checkout.
   * Absent for an ordinary session (the common case) and for a session whose cwd
   * is outside every worktree of its project, which the row draws the same way.
   */
  worktree?: SessionWorktreeInfo;
}

/**
 * A sidebar workspace folder. In real mode folders are SQLite workspaces that
 * carry an optional `project_path` binding the folder to an oh-my-pi project
 * root; the folder name is the lowercase basename of that path.
 */
export interface WorkspaceFolderData {
  id: number;
  name: string;
  /** When set, this workspace is bound to an oh-my-pi project root; sessions
   *  discovered under that root render inside this folder. */
  project_path?: string | null;
  /** When true, the workspace is pinned and sorts to the top of the sidebar. */
  isPinned?: boolean;
  isExpanded: boolean;
  model?: string;
  accentColor?: string;
  icon?: string;
  customIconUrl?: string;
  sessions: SessionItemData[];
  hasMore: boolean;
  totalSessions: number;
  badge?: number | string;
  dotCount?: number;
  iconType?: 'chat' | 'folder' | 'code';
}

export type SessionSortOption = 'A-Z' | 'Z-A' | 'LATEST_SESSION' | 'LATEST_ADDED';

export type ViewportMode =
  | 'responsive'
  | 'desktop-16-9'
  | 'laptop'
  | 'tablet'
  | 'mobile'
  | 'mobile-lg';
