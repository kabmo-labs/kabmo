import { lazy } from 'preact/compat';
import type { ComponentType, ReactNode } from 'preact/compat';
import {
  BarChart3,
  BookOpen,
  Bot,
  ClipboardList,
  Files,
  GitBranch,
  Globe,
  Layers,
  ListTodo,
  Search,
  Terminal,
} from 'lucide-preact';

import {
  DEFAULT_RIGHT_PANEL_FRACTION,
  DEFAULT_RIGHT_PANEL_WIDTHS,
  MIN_RIGHT_PANEL_WIDTHS,
  PANEL_MARK_SIZE,
  RIGHT_PANEL_TYPES,
  type RightPanelType,
} from '@/shared/lib/workspace/right-panels';
import type { AgentStreamStatus } from '@/shared/lib/chat/omp/status';

/**
 * Props a panel BODY may receive.
 *
 * Every built-in view takes the same shape, and the layout passes it uniformly
 * so the desktop stack and the phone's drawer cannot drift into handing
 * different subsets to the same view. A view ignores what it does not use,
 * which is why they are all optional but for the three the layout always knows.
 *
 * It lives HERE rather than beside the plugin resolver because a view's type is
 * what a view is checked against: putting it in the resolver would make this
 * module import the resolver that imports it.
 */
export interface PanelBodyProps {
  className?: string;
  /** The active session id — a plugin's props contract takes it explicitly. */
  sessionId?: string | null;
  /** False when the view has nothing to read — no workspace, or it is hidden. */
  enabled: boolean;
  /** True while this is the view on screen. */
  active: boolean;
  /** Bumped after a write, so a tree/list view re-reads. */
  refreshKey: number;
  rootPath?: string;
  onRefresh?: () => void;
  onOpenFile?: (file: unknown) => void;
  onClose?: () => void;
  /** The phone's drawer hides a view's own header; the desktop stack does not. */
  showHeader?: boolean;
  /**
   * The boot settings snapshot, for the views that read it (the session list
   * passes it to its own Settings modal and to the prewarm's access mode).
   */
  appSettings?: Record<string, any>;
  /** The live agent stream status, for the session list's wordmark badge. */
  streamStatus?: AgentStreamStatus;
}

/**
 * The built-in right-panel views, as one table.
 *
 * This is the built-in half of the panel catalog, and it exists so the built-in
 * views and the installed plugins travel the SAME path: the activity bar, the
 * desktop panel stack and the phone's tab bar read one merged list, and
 * enablement is one set of ids. Before this the built-ins were three literal
 * objects — `RIGHT_PANEL_TYPES` for the order, `PANEL_META` for the titles and
 * icons, `lazy-panels.tsx` for the components — that had to agree by hand.
 *
 * Two properties are load-bearing:
 *
 * - **The components are `lazy()` at module scope.** A built-in panel's code is
 *   still split into its own chunk and fetched only when the view is first
 *   rendered, which is what `lazy-panels.tsx` used to arrange. Because the
 *   `lazy()` wrapper is created ONCE, its identity is stable across renders —
 *   which is what keeps a view mounted (and its tree expansion, terminal buffer
 *   and search results alive) while the layout hides it with CSS.
 * - **`requiresWorkspace` is data, not a condition at a call site.** A view that
 *   reads the working tree is inert until a folder is active; a view that reads
 *   the SESSION (todos, a plan, a browser, usage) is not, and gating those made
 *   them show "No session selected" over content they could draw. The phone's
 *   drawer and the desktop stack both consult this, so the two cannot disagree.
 */
export interface BuiltinPanelView {
  /** The view id — also its enablement key, and its slot in `layout.activeRightPanel`. */
  id: RightPanelType;
  /** The activity bar's tooltip and the phone's chip label. */
  title: string;
  /** The short label the phone's chip shows beside its icon. */
  label: string;
  icon: ReactNode;
  Component: ComponentType<PanelBodyProps>;
  /** Floor in px, the px width it opens at, and its share of the group's area. */
  minWidth: number;
  defaultWidth: number;
  defaultFraction: number;
  /**
   * Whether the view needs an active workspace folder.
   *
   * A view that reads the working tree genuinely needs one. A view that reads
   * the SESSION — todos, a plan, usage, either browser — does not: those stay
   * reachable for a session running outside every registered workspace.
   */
  requiresWorkspace: boolean;
  /**
   * Whether the view must keep working while another one is on screen.
   *
   * Only the terminal sets it: it owns a live PTY stream, and pausing it because
   * the user looked at Files would kill the shell's output.
   */
  liveWhileHidden?: boolean;
}

const META: Record<
  RightPanelType,
  { title: string; label: string; icon: ReactNode; requiresWorkspace: boolean; liveWhileHidden?: boolean }
> = {
  context: { title: 'Context & Telemetry', label: 'Context', icon: <Layers size={PANEL_MARK_SIZE} />, requiresWorkspace: true },
  files: { title: 'Files', label: 'Files', icon: <Files size={PANEL_MARK_SIZE} />, requiresWorkspace: true },
  search: { title: 'Search', label: 'Search', icon: <Search size={PANEL_MARK_SIZE} />, requiresWorkspace: true },
  git: { title: 'Source Control', label: 'GIT', icon: <GitBranch size={PANEL_MARK_SIZE} />, requiresWorkspace: true },
  wiki: { title: 'Wiki', label: 'Wiki', icon: <BookOpen size={PANEL_MARK_SIZE} />, requiresWorkspace: true },
  terminal: {
    title: 'Terminal (Bun)',
    label: 'Terminal',
    icon: <Terminal size={PANEL_MARK_SIZE} />,
    requiresWorkspace: true,
    liveWhileHidden: true,
  },
  'user-browser': { title: 'Browser (Anda)', label: 'Browser', icon: <Globe size={PANEL_MARK_SIZE} />, requiresWorkspace: false },
  browser: { title: 'Browser Agent', label: 'Agent', icon: <Bot size={PANEL_MARK_SIZE} />, requiresWorkspace: false },
  usage: { title: 'Usage', label: 'Usage', icon: <BarChart3 size={PANEL_MARK_SIZE} />, requiresWorkspace: false },
  todo: { title: 'Todos', label: 'Todos', icon: <ListTodo size={PANEL_MARK_SIZE} />, requiresWorkspace: false },
  plan: { title: 'Plan (sesi ini)', label: 'Plan', icon: <ClipboardList size={PANEL_MARK_SIZE} />, requiresWorkspace: false },
};

const LAZY_VIEWS: Record<RightPanelType, ComponentType<PanelBodyProps>> = {
  context: lazy(() =>
    import('@/client/components/workspace/context-panel/index').then((m) => ({ default: m.ContextPanel })),
  ),
  files: lazy(() =>
    import('@/client/components/workspace/file-explorer/index').then((m) => ({ default: m.FileExplorer })),
  ),
  search: lazy(() =>
    import('@/client/components/workspace/search-panel/index').then((m) => ({ default: m.SearchPanel })),
  ),
  git: lazy(() => import('@/client/components/workspace/git-panel/index').then((m) => ({ default: m.GitPanel }))),
  wiki: lazy(() => import('@/client/components/workspace/wiki-panel/index').then((m) => ({ default: m.WikiPanel }))),
  terminal: lazy(() =>
    import('@/client/components/workspace/terminal-panel/index').then((m) => ({ default: m.TerminalPanel })),
  ),
  'user-browser': lazy(() =>
    import('@/client/components/workspace/user-browser-panel/index').then((m) => ({ default: m.UserBrowserPanel })),
  ),
  browser: lazy(() =>
    import('@/client/components/workspace/browser-panel/index').then((m) => ({ default: m.BrowserPanel })),
  ),
  usage: lazy(() =>
    import('@/client/components/workspace/usage-panel/index').then((m) => ({ default: m.UsagePanel })),
  ),
  todo: lazy(() => import('@/client/components/workspace/todo-panel/index').then((m) => ({ default: m.TodoPanel }))),
  plan: lazy(() => import('@/client/components/workspace/plan-panel/index').then((m) => ({ default: m.PlanPanel }))),
};

/**
 * Every built-in view, in the activity-bar order.
 *
 * `RIGHT_PANEL_TYPES` stays the order's single source — it is shared (no client
 * import) because the width map and the persisted-id guard read it too — and the
 * geometry comes from the tables that were already keyed by it, so this adds no
 * second copy of either.
 */
export const BUILTIN_PANELS: readonly BuiltinPanelView[] = RIGHT_PANEL_TYPES.map((id) => ({
  id,
  ...META[id],
  Component: LAZY_VIEWS[id],
  minWidth: MIN_RIGHT_PANEL_WIDTHS[id],
  defaultWidth: DEFAULT_RIGHT_PANEL_WIDTHS[id],
  defaultFraction: DEFAULT_RIGHT_PANEL_FRACTION,
}));

/** Every built-in view id, for the guard and the id checks. */
export const BUILTIN_PANEL_IDS: readonly string[] = RIGHT_PANEL_TYPES;

/**
 * The built-in views that are switched ON, in order.
 *
 * Enablement is the SAME set the plugins use, so a built-in view is off by its
 * bare id (`git`) and a plugin by `plugin:<id>`. Absent means enabled, which is
 * what makes a fresh install show every view and a database written before this
 * feature keep all of them on.
 */
export function enabledBuiltinPanels(disabled: readonly string[]): BuiltinPanelView[] {
  if (disabled.length === 0) return [...BUILTIN_PANELS];
  const off = new Set(disabled);
  return BUILTIN_PANELS.filter((panel) => !off.has(panel.id));
}
