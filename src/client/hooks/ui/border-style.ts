/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The single writer for the app's border style.
 *
 * The style is an ATTRIBUTE on `<html>`, and CSS is its only consumer: the
 * `[data-borders="borderless"]` tables live in `src/client/borders.css`. That is
 * why this module exports no hook — nothing in the shell reads the value in
 * JavaScript, and a hook would exist only to re-render subtrees CSS already
 * repaints.
 *
 * The attribute is written at boot (`initBorderStyle`, before the first render)
 * so a borderless document never paints one ruled frame first, and on every
 * change from the settings modal (`applyBorderStyle`).
 *
 * There is deliberately no document observer, unlike `theme.ts`: the theme has
 * runtime consumers that cannot read CSS (the mermaid hydrator repaints diagrams
 * per palette), so it needs an event. A hairline has none.
 */

import { readKabmoSetting } from '@/shared/lib/settings/client';
import {
  BORDER_ATTRIBUTE,
  BORDER_STYLE_SETTING_KEY,
  BORDER_STYLE_WITHOUT_ATTRIBUTE,
  resolveBorderStyle,
} from '@/shared/lib/theme/border-style';

/**
 * Point the document at `style`.
 *
 * The style CSS paints with no attribute is REMOVED rather than written, so a
 * document carrying `hairline` and a document carrying nothing are the same
 * state — which is what makes the rule set in `tailwind.css` the single
 * statement of the ruled look. The comparison is against that ABSENT state, not
 * against `DEFAULT_BORDER_STYLE`: if a later release makes `borderless` the
 * default, omitting the attribute for it would paint rules while the setting
 * says borderless.
 */
export function applyBorderStyle(style: unknown): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const resolved = resolveBorderStyle(style);
  if (resolved === BORDER_STYLE_WITHOUT_ATTRIBUTE) root.removeAttribute(BORDER_ATTRIBUTE);
  else root.setAttribute(BORDER_ATTRIBUTE, resolved);
}

/**
 * Apply the stored style before the first render.
 *
 * Called from `main.tsx` right after `primeKabmoSettings`, because the boot
 * payload is what `readKabmoSetting` answers from. Without it a borderless
 * install would paint the ruled shell for one frame and then swap it.
 */
export function initBorderStyle(): void {
  applyBorderStyle(readKabmoSetting<unknown>(BORDER_STYLE_SETTING_KEY));
}
