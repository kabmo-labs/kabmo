/**
 * Session item shape. In real (non-mock) mode sessions come from oh-my-pi
 * JSONL discovery and use the omp session UUID (string) as id — hence the
 * union with string ids. Mock/demo mode keeps numeric SQLite ids.
 */
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
  /** Server-tracked stream state: `stream` while a run is in flight, then a
   *  one-shot `finish`/`abort` badge cleared when the session opens. */
  streamStatus?: 'stream' | 'finish' | 'abort';
  /** Live-only: the session's omp process is BLOCKED on an ask/approval dialog
   *  waiting for a user answer. Derived from the running process registry, never
   *  persisted — the process it describes is the same thing that owns the flag. */
  awaitingInput?: boolean;
  /** Model serving the session's current run — persisted beside `streamStatus`
   *  (session_stream_state) so the generating indicator names the real
   *  provider/model in every tab and Kabmo instances. Absent for a session
   *  with no run row; callers fall back to the transcript's model entry. */
  runModel?: { provider: string; modelId: string };
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
