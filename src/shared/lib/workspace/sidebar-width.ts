/**
 * The session sidebar's width.
 *
 * GLOBAL, unlike every other panel. The sidebar shows the same list in every
 * session — only the highlight moves — so a width that changed when the user
 * picked a different session read as the layout jumping for no reason. The
 * editor and the right panel describe one session's working state and stay in
 * `layout.panelWidths`; this one is a Kabmo setting, stored in `app_settings`
 * beside the sidebar's other cross-session state
 * (`omp_sidebar_expanded_sessions`, `omp_sidebar_sort`).
 *
 * It was not always. `0004c95` moved every width — this one included — out of a
 * single global `app_settings.desktopLayoutSizes` blob and into the per-session
 * map, so the sidebar came along with panels that had a reason to be there.
 * `desktopLayoutSizes` survived as that map's seed until `9d361a9` dropped it,
 * which removed the last thing that could have kept a dragged sidebar width from
 * being per session.
 *
 * The migration is a PRECEDENCE, resolved once and then pinned: the new setting,
 * else the retired GLOBAL blob, else — only when neither exists — the session
 * slot of whichever session is open. A session's own `left` is the LAST resort
 * and never the first choice, because 120 sessions on this install carry the
 * same seeded value while a handful carry a local drag: adopting a session slot
 * first would move the sidebar 351 → 500 on the first switch, which is the
 * symptom this module exists to end.
 */
import { readKabmoSetting, writeSetting } from '@/shared/lib/settings/client';

/** `app_settings` key holding the sidebar's width, in pixels. */
export const SIDEBAR_WIDTH_SETTING_KEY = 'omp_sidebar_width';

/** The retired blob the width lived in before per-session storage. */
const LEGACY_SIZES_KEY = 'desktopLayoutSizes';

/**
 * Fallback for the sidebar, which has no fraction: a session list does not get
 * more useful on a wider monitor, so this slot is pixels only.
 */
export const DEFAULT_LEFT_PANEL_WIDTH = 280;

/**
 * Sidebar floor and ceiling. The ceiling is half of a pair with
 * `MIN_CHAT_PANEL_WIDTH` in `panel-widths.ts`: the sidebar cannot open past 500
 * and still leave the editor (320) and a browser view (320) room on a 1440px
 * display.
 *
 * It was raised to 720 for a second left pane and put back when that pane was
 * removed: the dock holds ONE panel beside the list, and a wider ceiling would
 * only invite a column nothing else in the layout budgets for.
 */
export const MIN_LEFT_PANEL_WIDTH = 264;
export const MAX_LEFT_PANEL_WIDTH = 500;

/**
 * Every read and every write of this slot is clamped, so a value from an older
 * build cannot open the panel outside the range its separator allows.
 */
function clampedSidebarWidth(px: number): number {
  return Math.min(MAX_LEFT_PANEL_WIDTH, Math.max(MIN_LEFT_PANEL_WIDTH, Math.round(px)));
}

/** A finite number, or `undefined` — the shape every stored source must have. */
function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The retired global blob's `left`, when the row is still on disk. */
function legacyGlobalWidth(): number | undefined {
  const sizes = readKabmoSetting<unknown>(LEGACY_SIZES_KEY);
  if (typeof sizes !== 'object' || sizes === null || !('left' in sizes)) return undefined;
  return finiteOrUndefined(sizes.left);
}

/** The stored setting, or `undefined` when this install has never written one. */
function storedWidth(): number | undefined {
  return finiteOrUndefined(readKabmoSetting<unknown>(SIDEBAR_WIDTH_SETTING_KEY));
}

/**
 * Resolve the sidebar width and pin it, once. Called on every layout mount and
 * again when a session's blob arrives, so the session slot is only ever consulted
 * while nothing has been stored yet — after the first pass the setting exists and
 * every later session reads it.
 *
 * `sessionSlot` is the retired `layout.panelWidths.left` of the open session, or
 * `undefined`.
 */
export function resolveSidebarWidth(sessionSlot?: unknown): number {
  const stored = storedWidth();
  if (stored !== undefined) return clampedSidebarWidth(stored);

  const legacy = legacyGlobalWidth();
  if (legacy !== undefined) {
    writeSetting(SIDEBAR_WIDTH_SETTING_KEY, clampedSidebarWidth(legacy));
    return clampedSidebarWidth(legacy);
  }

  const slot = finiteOrUndefined(sessionSlot);
  if (slot !== undefined) {
    writeSetting(SIDEBAR_WIDTH_SETTING_KEY, clampedSidebarWidth(slot));
    return clampedSidebarWidth(slot);
  }

  return DEFAULT_LEFT_PANEL_WIDTH;
}

/** Persist a dragged width. */
export function saveSidebarWidth(px: number): void {
  writeSetting(SIDEBAR_WIDTH_SETTING_KEY, clampedSidebarWidth(px));
}
