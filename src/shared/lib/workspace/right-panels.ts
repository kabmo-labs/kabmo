/**
 * Right developer panel catalog: the activity-bar views, the share of the
 * group's available area each one opens at, and the floor at which its content
 * clips.
 *
 * The list lives here rather than in the activity bar component so the layout
 * can key one remembered width per view (`panel-widths.ts`) and validate a
 * stored blob without importing UI. It is also the single source of the views'
 * *order*: the desktop activity bar, the desktop panel stack and the phone's
 * tab bar all render from it, so the two layouts cannot drift apart.
 */
export const RIGHT_PANEL_TYPES = [
  'context',
  'files',
  'search',
  'git',
  // Beside Source Control: a wiki is read off the same remote and the same
  // repo pick, so the two are one pair in the bar rather than one at each end.
  'wiki',
  'terminal',
  'user-browser',
  'browser',
  'usage',
  'todo',
  // Beside Todos: both are the SESSION's own state rather than the working
  // tree's, and both stay reachable for a session running outside every
  // registered workspace.
  'plan',
] as const;

export type RightPanelType = (typeof RIGHT_PANEL_TYPES)[number];

/**
 * The box an activity-bar mark is drawn in, on BOTH layouts.
 *
 * One constant rather than a literal per call site, because the two layouts drew
 * a plugin's mark at different sizes (`size={16}` on the desktop bar, `size={14}`
 * on the phone's tab strip) while every built-in view's icon is `<… size={16} />`
 * in the shared meta table. A plugin's button was therefore 12.5% smaller than
 * its neighbours on the phone, and matching them meant editing two files that had
 * no reason to disagree.
 */
export const PANEL_MARK_SIZE = 16;

/**
 * Share of the group's available area the right panel opens at.
 *
 * ONE default for every view, not a per-view table. The right panel is half of
 * a COUPLED pair with the editor (`panel-widths.ts`): they share a combined
 * budget and each is capped, so the editor's default and this one must sum to
 * the pair's default (0.4 + 0.3 = 0.7). A per-view fraction would break that
 * sum — a 0.6 terminal beside a 0.4 editor is 1.0 — so the views differ only by
 * their floor (`MIN_RIGHT_PANEL_WIDTHS`) and their remembered width, which a
 * drag still stores per view.
 */
export const DEFAULT_RIGHT_PANEL_FRACTION = 0.3;

/**
 * Width (px) a view opens at before the group's area has been measured. Kept at
 * the values these views shipped with, so the first paint is unchanged and a
 * window that never reports an area still opens sensibly.
 */
export const DEFAULT_RIGHT_PANEL_WIDTHS: Record<RightPanelType, number> = {
  context: 536,
  files: 268,
  search: 268,
  git: 268,
  terminal: 640,
  'user-browser': 804,
  browser: 804,
  usage: 536,
  todo: 384,
  wiki: 600,
  plan: 600,
};

/**
 * Minimum width (px) each view needs before its toolbar or list breaks.
 *
 * Per view, not one shared floor: a file tree reads fine at 200 while a shell
 * does not, and OpenChamber draws the same line (its tree-only column floors at
 * 200, its shared panel at 320). A uniform floor would either clip the tree or
 * force every view to shell width.
 */
export const MIN_RIGHT_PANEL_WIDTHS: Record<RightPanelType, number> = {
  files: 200,
  search: 200,
  // The commit graph is a fixed-width gutter plus a message column.
  git: 260,
  // A 320px terminal is ≈27 columns — below every shell's assumption, but the
  // point where a two-pane TUI or a git log with the graph still reads.
  terminal: 320,
  // Telemetry charts and tables need room before they wrap.
  context: 420,
  'user-browser': 320,
  browser: 320,
  usage: 420,
  // Below this a task line wraps to three words a row.
  todo: 280,
  // The page list needs its 208px beside a readable measure; under 420 the two
  // columns collapse into a drill-down.
  wiki: 420,
  // Same two-column reader as the wiki, so the same floor.
  plan: 420,
};

/** Guards a persisted or URL-provided view id before it keys a width. */
export function isRightPanelType(value: unknown): value is RightPanelType {
  return typeof value === 'string' && (RIGHT_PANEL_TYPES as readonly string[]).includes(value);
}
