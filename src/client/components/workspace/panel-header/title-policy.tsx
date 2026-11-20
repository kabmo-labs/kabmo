/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a view's header still has to say when the COLUMN already names the view.
 *
 * Under the rail the panel's header is the only place its identity appears, so
 * it carries a title (`Todos`, `Usage`, `Search`). Under the tab strip the chip
 * is that title — and a header drawn beneath it repeated the same word in a
 * second row, which is what the first tab-style render looked like: a strip, a
 * blank-looking band, then the body.
 *
 * **The header is not removed, and that distinction is the point.** Almost every
 * view's header also carries facts a chip cannot: the repo picker (Files, WIKI,
 * Search, GIT, Terminal), a live progress line (`3/8 · 38%`), a timestamp
 * (`Updated …`), a provider badge, the refresh control, the search options menu.
 * Deleting the row would delete those. So the strip's presence suppresses only
 * the TITLE, and the row keeps its height and its controls.
 *
 * A view with nothing BUT a title keeps its title: suppressing it would leave an
 * empty 40px band, which is worse than the repeat. `SHOW_TITLE_IN_TABS` is that
 * exception, and it is data rather than a branch at each call site.
 */

import type { ReactNode } from 'preact/compat';

/**
 * Views whose header is ONLY a title, so the tab style hides the whole row.
 *
 * Every view here was read before it was added: `Todos` is its title plus a
 * progress line that its own body also draws, and `Plan`'s second element is a
 * file count whose list is right underneath. Everything else keeps its header
 * with only the TITLE suppressed, because it carries a fact the chip cannot:
 * `Usage` a generation timestamp, `Context` a session title and time, `Search`
 * and the repo-scoped views their picker.
 *
 * Adding a view here without reading its header is how a picker or a timestamp
 * disappears — which is exactly what the first pass did to `Usage`.
 */
const HEADER_IS_ONLY_A_TITLE = new Set(['todo', 'plan']);

/**
 * Whether a view should draw its own header row at all.
 *
 * `false` only when the strip names the view (tabs mode) AND the header carries
 * nothing but that name.
 */
export function showsPanelHeader(viewId: string, tabsMode: boolean): boolean {
  if (!tabsMode) return true;
  return !HEADER_IS_ONLY_A_TITLE.has(viewId);
}

/**
 * Whether a header that IS drawn should still state the view's name.
 *
 * Under the rail: yes, always. Under the strip: only for a view whose header is
 * the name and nothing else — those are handled by `showsPanelHeader`, so a
 * drawn header never repeats the chip.
 */
export function showsPanelTitle(tabsMode: boolean): boolean {
  return !tabsMode;
}

/**
 * The one heading a view header draws, so the tab rule lives in one place.
 *
 * Renders `null` when the column already names the view; a caller spreads it
 * into its own slot, and an empty result leaves the row's other controls alone.
 */
export function PanelHeading({
  id,
  tabsMode,
  children,
}: {
  id: string;
  tabsMode: boolean;
  children: ReactNode;
}) {
  if (!showsPanelHeader(id, tabsMode) || !showsPanelTitle(tabsMode)) return null;
  return <>{children}</>;
}
