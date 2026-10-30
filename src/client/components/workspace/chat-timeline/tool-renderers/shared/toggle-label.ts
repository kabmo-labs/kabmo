/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one wording every tool render style uses for its expand control.
 *
 * `chat.e2e.ts` collects the transcript's tool rows by
 * `[aria-label^="Expand "]` and requires each to name its tool, and
 * `mobile.e2e.ts` / `tool-diff-scroll.e2e.ts` click `/^Expand Bash/` and
 * `/^Expand Edit/`. A style that invented its own wording would read as a card
 * with no title, so the builder lives here and every style — the card included
 * — calls it.
 */

export function toolToggleLabel(title: string, subtitle: string | undefined, isExpanded: boolean): string {
  return `${isExpanded ? 'Collapse' : 'Expand'} ${title}${subtitle ? ` — ${subtitle}` : ''}`;
}
