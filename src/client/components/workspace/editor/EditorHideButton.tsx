/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor column's own switch, drawn in its top-right corner.
 *
 * It lives on the panel rather than in the top navbar because it acts on the
 * column under it: the navbar's row now switches the whole right SIDE (editor,
 * panel and rail) with one control, and the column's own switch belongs beside
 * the tabs it is about. The chord is the same one the command palette lists
 * (`⌘J`), named in the tooltip so the button and the keymap cannot drift.
 *
 * Hiding the column is the one direction this button can take — once it is
 * closed it has no corner to sit in — so reopening is `⌘J`, the palette, or the
 * navbar's side toggle, which shows everything.
 *
 * The glyph is `PanelRightClose`, not the `PanelRight` the split toggle beside
 * it draws: two identical marks a few pixels apart would be one control drawn
 * twice, and the close glyph is the same one the navbar used for this action
 * before the move.
 */

import { PanelRightClose } from 'lucide-preact';
import { withChord } from '@/client/lib/ui/with-chord';

export function EditorHideButton({ onHide }: { onHide: () => void }) {
  const label = withChord('toggleEditorPanel', 'Hide Editor Panel');
  return (
    <button
      type="button"
      onClick={onHide}
      className="p-1.5 mx-1 rounded transition-colors cursor-pointer text-ink/60 hover:bg-ink/10 hover:text-ink flex-shrink-0"
      title={label}
      aria-label={label}
    >
      <PanelRightClose size={14} />
    </button>
  );
}
