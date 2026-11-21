/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone editor's `⋯` menu: the actions that do not need a standing slot.
 *
 * The title bar had nine controls in one 390px row, each measured at 27x27 —
 * under the 36px phone-chrome plate and 17px under the 44px touch floor. Word
 * wrap and the two zoom steps are settings a reader changes once; copy and
 * download are one-shot exports. Behind `⋯` they cost 36px ONCE instead of
 * 180px standing in the row, and each is named in words rather than as a glyph.
 *
 * This is the same answer `header-controls/MoreMenu` and the sidebar toolbar's
 * `ToolbarOverflowMenu` reached: hiding a control outright makes it unreachable
 * at one width, and letting the row overflow hides it behind a scroll with
 * nothing on screen to say so.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { Ellipsis, type LucideIcon } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { CONTROL_BOX, CONTROL_GLYPH_PX } from '@/client/lib/ui/control-plate';

/** One row: what it says, its glyph, what it does. */
export interface EditorOverflowAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
}

export function EditorOverflowMenu({ actions }: { actions: EditorOverflowAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);

  // Escape closes, like every other menu in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="relative flex-none" ref={ref}>
      {/* The menu OWNS its trigger. The row used to pass one in wrapped by a
          click handler, which left the button's own `onClick` a no-op — a
          control whose handler is a lie, and the one thing a test cannot catch
          because the wrapper still opens the menu. */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title="More file actions"
        aria-label="More file actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${CONTROL_BOX.mobile} flex-none cursor-pointer rounded-lg text-ink/70 transition-colors hover:bg-ink/10 hover:text-ink`}
      >
        <Ellipsis size={CONTROL_GLYPH_PX.mobile} />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="File actions"
          className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-ink/15 bg-paper py-1 text-xs shadow-lg"
        >
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  action.onSelect();
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-ink/80 transition-colors hover:bg-ink/5 hover:text-ink"
              >
                <Icon size={15} className="flex-none text-ink/60" />
                <span className="truncate">{action.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
