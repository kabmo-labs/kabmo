/**
 * Per-panel width state for the desktop layout.
 *
 * Every resizable surface remembers its OWN width: the editor panel (source and
 * diff tabs separately, since a diff wants room a file view does not) and each
 * right-panel view (see `right-panels.ts`). Collapsing those into one slot per
 * group is what made switching a panel look like a reset. The chat column is the
 * group's filler — flexbox sizes it — so it has no remembered width, only a
 * floor it may not be pushed below.
 *
 * The **sidebar is deliberately NOT here**: it is the one surface that shows the
 * same thing in every session, so its width lives in `app_settings` instead
 * (`sidebar-width.ts`). A `left` slot in this map changed the sidebar whenever
 * the user picked a different session.
 *
 * The editor and right panels are a *share of the group's available area*. A
 * pixel width is only right on the display it was dragged on; a fraction
 * follows a window resize. A remembered pixel value is kept alongside as the
 * fallback for the window before the area is measured and for blobs written
 * before the fraction existed.
 *
 * Sizes persist per session as `layout.panelWidths` in `session_ui_state`.
 */
import { isPanelId } from '@/shared/lib/workspace/panel-ids';

/** The editor panel keeps a separate width while a diff tab is active. */
export type EditorWidthMode = 'editor' | 'diff';

/**
 * A panel width in both units. `fraction` is authoritative once the group's
 * area is known; `px` is what the panel falls back to before then, and what a
 * blob written before fractions existed carries.
 */
export interface PanelWidth {
  px?: number;
  fraction?: number;
}

export interface PanelWidths {
  /** Editor panel while a source file tab is active. */
  editor?: PanelWidth;
  /** Editor panel while a diff tab is active. */
  diff?: PanelWidth;
  /**
   * Right panel, keyed by the activity-bar view it currently shows. A plugin
   * panel keys by its own `plugin:<id>/<panel>` string, so this is a plain
   * string map rather than the built-in union — the layout stores whichever id
   * is active, and `mergePanelWidths` keeps only entries whose id parses.
   */
  right?: Record<string, PanelWidth>;
}

/**
 * Fraction each editor mode opens at, and the px width used before the group's
 * area is known. 0.4 of the group leaves the chat column the majority of the
 * workspace at every width; 0.6 read as too wide. The diff px fallback stays
 * wider than the source editor's because `SplitView` states a 700px floor of
 * its own, so anything below it scrolls sideways.
 */
export const DEFAULT_EDITOR_FRACTIONS: Record<EditorWidthMode, number> = {
  editor: 0.4,
  diff: 0.4,
};

export const DEFAULT_EDITOR_WIDTHS: Record<EditorWidthMode, number> = {
  editor: 600,
  diff: 720,
};

/**
 * The editor and the right panel share one budget.
 *
 * Their combined share of the group may not exceed `PAIR_MAX_TOTAL_FRACTION`,
 * and neither panel may exceed `PAIR_MAX_FRACTION` on its own. The two are what
 * make the pair interdependent: growing one past the default forces the other
 * to give way, and neither can reach its own maximum while the other is open.
 * The chat floor (`MIN_CHAT_PANEL_WIDTH`) is a THIRD, tighter cap on narrow
 * groups — at a 1440-class viewport it is what binds, not the 0.7.
 */
export const PAIR_MAX_TOTAL_FRACTION = 0.7;
export const PAIR_MAX_FRACTION = 0.6;

/**
 * Panel floors and ceilings. The chat floor pairs with the sidebar ceiling in
 * `sidebar-width.ts`: `MIN_CHAT_PANEL_WIDTH` is what stops the workspace stack
 * from eating the conversation, and it is also why the sidebar cannot open past
 * 500 and still leave the editor (320) and a browser view (320) room on a
 * 1440px display.
 *
 * `MIN_EDITOR_PANEL_WIDTH` matches the shared right-panel floor so the two
 * panels cannot disagree about the narrowest width the same content is shown
 * at.
 */
export const MIN_CHAT_PANEL_WIDTH = 400;
export const MIN_EDITOR_PANEL_WIDTH = 320;

/** Draggable separator width in px (`w-[3px]` in `ResizeHandle`). */
export const HANDLE_WIDTH = 3;

/** How much of a drag may re-apply the real width, in ms. */
export const RESIZE_FOLLOW_INTERVAL_MS = 100;

/**
 * The fraction a slot WANTS: a remembered fraction, else a px value converted
 * against the area, else the default.
 *
 * Exported because the coupled pair needs each other's wanted fraction before
 * either is resolved — the pair caps are symmetric (`right` caps `editor` by
 * its wanted share and vice versa), so a caller cannot wait for one result to
 * compute the other's cap.
 */
export function panelFraction(stored: PanelWidth | undefined, defaultFraction: number, available: number | null): number {
  if (stored?.fraction != null) return stored.fraction;
  if (stored?.px != null && available != null && available > 0) return Math.min(1, stored.px / available);
  return defaultFraction;
}

export interface ResolveWidthArgs {
  /** Remembered width for this slot, if the user ever resized it. */
  stored?: PanelWidth;
  /** Fraction this slot opens at when nothing was remembered. */
  defaultFraction: number;
  /** px this slot opens at before the area is known. */
  defaultPx: number;
  /** Measured area of the group, or null before the observer reports. */
  available: number | null;
  min: number;
  /**
   * Pixels the OTHER panel in the coupled pair reserves, for the pair cap.
   *
   * The pair shares `PAIR_MAX_TOTAL_FRACTION`, so this panel's cap is
   * `total × available − pairReservePx`. The value is asymmetric on purpose:
   * the right panel reserves the editor's WANTED share (the editor is not
   * resolved yet), and the editor reserves the right panel's ACTUAL width — so
   * when the editor is asked for more than its default the right panel gives
   * way first, and the pair still sums to the total. 0 when the sibling is
   * closed or this panel is not part of the pair (the sidebar).
   */
  pairReservePx?: number;
  /**
   * Width the OTHER fixed panels in the same group reserve, in px.
   *
   * A sibling that has not been resolved yet contributes its floor; one that
   * has contributes the width it actually got. The distinction is the whole
   * point of the two-call order in `WorkspacePanels`: reserving only a
   * sibling's FLOOR lets two declared widths sum past the group, and flexbox
   * then shrinks BOTH panels instead of clamping the one that should give way.
   */
  siblingWidth: number;
  /** Separators in the group, which also consume width. */
  handleCount: number;
}

/**
 * Resolve one panel's width in px.
 *
 * The ceiling is dynamic — `available − chat floor − the siblings' reserved
 * width − handles` — rather than a fixed number, because a fixed one either
 * wastes a large monitor or eats the chat on a small one.
 *
 * The editor and the right panel share one budget, so the CALLER decides who
 * gives way by the order it resolves them and by what it passes as
 * `pairReservePx`/`siblingWidth`. Resolving the right panel first (reserving
 * the editor's WANTED share) and then the editor against the right panel's
 * real width keeps the two declared widths inside the group AND makes the
 * right panel yield first when the editor is asked for more than its default;
 * the reverse (each reserving only the other's floor) overflows and both get
 * squeezed by flexbox. `pairReservePx` is the second, softer cap: the pair's
 * combined share may not exceed `PAIR_MAX_TOTAL_FRACTION`.
 *
 * Without a measured area there is no budget to divide, so the stored or
 * default pixel width is used unchanged.
 */
export function resolvePanelWidth(args: ResolveWidthArgs): number {
  const { stored, defaultFraction, defaultPx, available, min, pairReservePx = 0, siblingWidth, handleCount } = args;

  if (available === null || available <= 0) return Math.max(min, Math.round(stored?.px ?? defaultPx));

  // The pair's cap on this panel, then the group's hard budget. Both are
  // ceilings; `min` still wins over either, because a panel squeezed below its
  // floor clips rather than collapsing. The pair cap is computed in PIXELS —
  // `total × available − the sibling's reserved px` — and ROUNDED, because
  // `0.7 × 4000` is `2799.9999…` in binary floating point and flooring it lands
  // a pixel short of the intended share.
  const ownCap = Math.round(PAIR_MAX_FRACTION * available);
  const pairCap = Math.round(PAIR_MAX_TOTAL_FRACTION * available) - pairReservePx;
  const ceiling = Math.max(
    min,
    Math.min(
      ownCap,
      pairCap,
      Math.floor(available - MIN_CHAT_PANEL_WIDTH - siblingWidth - handleCount * HANDLE_WIDTH),
    ),
  );

  // A remembered fraction wins. A px-only value is honoured as written — the
  // conversion below is an identity, deliberately: a pixel width someone chose
  // is not silently rescaled, and it starts following the window only once that
  // slot is dragged, which stores a fraction beside it. Reading rather than
  // rewriting the stored blob is also what keeps a session's own widths from
  // being clobbered by the global seed before that session's blob has loaded.
  const wanted = Math.round(panelFraction(stored, defaultFraction, available) * available);

  return Math.min(Math.max(wanted, min), ceiling);
}

/**
 * The floor the FILLER panel (the chat column) may actually hold, in px.
 *
 * `MIN_CHAT_PANEL_WIDTH` is a WISH, not a guarantee: it is only satisfiable
 * while the group can spare it. A fixed floor on the filler is what pushes the
 * whole group past its own box on a narrow window — the filler keeps 400px, the
 * right panel keeps its own floor (420 for Stats), the handles keep 3, and
 * `400 + 420 + 3 > 595` makes the flex row overflow its container. The group
 * itself is `flex-1 min-w-0`, so its clientWidth stays put and only its
 * `scrollWidth` grows: the right panel is laid out PAST the viewport edge, and
 * its own scroller and right-hand columns sit under (and beyond) the activity
 * bar with no scrollbar reachable to bring them back. Measured at 922x1568:
 * group clientWidth 595, scrollWidth 821, Stats table right edge 182px past the
 * viewport.
 *
 * The filler is the panel that must give way, because it is the only one whose
 * content reflows gracefully — a chat column narrows, while a telemetry table
 * below its floor clips. So its floor becomes "as much as is left over", capped
 * at the wish: `min(MIN_CHAT_PANEL_WIDTH, available − the other panels)`. At a
 * healthy width the cap never binds and the floor is the wish; on a cramped
 * group the chat narrows (down to 0 in the worst case) so the fixed panels stay
 * on screen. Without a measured area there is nothing to divide, so the wish
 * stands — the same convention `resolvePanelWidth` uses.
 *
 * `reservedPx` is the widths the non-filler panels actually took plus the
 * separators between them, all of which are already resolved when this runs.
 */
export function fillerMinWidth(args: {
  /** Measured area of the group, or null before the observer reports. */
  available: number | null;
  /** Px the non-filler panels and their separators already occupy. */
  reservedPx: number;
}): number {
  const { available, reservedPx } = args;
  if (available === null || available <= 0) return MIN_CHAT_PANEL_WIDTH;
  return Math.max(0, Math.min(MIN_CHAT_PANEL_WIDTH, Math.floor(available - reservedPx)));
}

/**
 * The `maxSize` one of the coupled pair may be DRAGGED to, in px.
 *
 * `resolvePanelWidth` caps the widths it hands to `defaultSize`, but a
 * separator drag bypasses it: the resizer transfers pixels between two panels
 * clamped only by their own `maxSize`. Without a pair-aware max, dragging the
 * editor wide would push the pair past `PAIR_MAX_TOTAL_FRACTION`. Each panel's
 * max is the smaller of its own cap (`PAIR_MAX_FRACTION`) and the pair total
 * minus the sibling's FLOOR — the sibling gives way down to its minimum during
 * the drag, so reserving its CURRENT width instead would pin this panel's max
 * to the width it already has and freeze the separator (measured: both at
 * their defaults, `editorMax` equalled the editor's own width and neither
 * direction could move). `available` is null before the group is measured, in
 * which case there is no cap (`undefined`).
 */
export function pairMaxSize(args: {
  available: number | null;
  /** The sibling's floor in px, or 0 when it is closed. */
  siblingMin: number;
  /** The sibling is open and therefore reserves its floor from the pair total. */
  siblingOpen: boolean;
}): number | undefined {
  const { available, siblingMin, siblingOpen } = args;
  if (available === null || available <= 0) return undefined;
  const ownCap = Math.round(PAIR_MAX_FRACTION * available);
  if (!siblingOpen) return ownCap;
  const pairCap = Math.round(PAIR_MAX_TOTAL_FRACTION * available) - siblingMin;
  return Math.max(0, Math.min(ownCap, pairCap));
}

/**
 * Width defaults for a plugin-contributed panel.
 *
 * A plugin declares its own `minWidth` / `defaultFraction`, but neither is
 * trusted as the only source: a manifest can omit them or name a value that
 * makes a panel unusable (a 40px floor clips every toolbar), so the chamber's
 * own slot defaults are the floor under a declared value. A plugin panel is a
 * right-panel view, so it shares that slot's defaults.
 */
export function resolvePluginPanelWidths(panel: {
  minWidth?: number;
  defaultFraction?: number;
}): { min: number; fraction: number; px: number } {
  return {
    min: Math.max(MIN_PLUGIN_PANEL_WIDTH, Math.round(panel.minWidth ?? MIN_PLUGIN_PANEL_WIDTH)),
    fraction: Math.min(0.9, Math.max(0.2, panel.defaultFraction ?? DEFAULT_PLUGIN_PANEL_FRACTION)),
    px: DEFAULT_PLUGIN_PANEL_WIDTH,
  };
}

/** Floor for a plugin panel: below this its own toolbar wraps into noise. */
export const MIN_PLUGIN_PANEL_WIDTH = 320;
const DEFAULT_PLUGIN_PANEL_FRACTION = 0.4;
const DEFAULT_PLUGIN_PANEL_WIDTH = 560;

/**
 * Fold a freshly measured patch over the stored widths (one level deep for
 * `right`, and within a slot for its two units — a fraction patch must not
 * discard the px fallback it was derived from).
 *
 * A retired `left` slot is DROPPED rather than carried: a blob written while the
 * sidebar still lived in this map has one, and keeping it would leave a second
 * answer for a width that now has one home (`sidebar-width.ts`). `current` is
 * read from `session_ui_state`, so its type is the current `PanelWidths` while
 * its runtime value can still be the older shape.
 */
export function mergePanelWidths(current: PanelWidths, patch: PanelWidths): PanelWidths {
  // Declared as an intersection, not a cast: a persisted blob written before
  // the cutover still carries `left`, so the runtime shape is wider than
  // `PanelWidths` even though the read is typed as it.
  const next: PanelWidths & { left?: unknown } = { ...current, ...patch };
  delete next.left;
  if (patch.right) {
    const right: Record<string, PanelWidth> = { ...current.right };
    for (const [view, value] of Object.entries(patch.right)) {
      if (!isPanelId(view) || !value) continue;
      right[view] = { ...current.right?.[view], ...value };
    }
    next.right = right;
  }
  for (const key of ['editor', 'diff'] as const) {
    if (patch[key]) next[key] = { ...current[key], ...patch[key] };
  }
  return next;
}
