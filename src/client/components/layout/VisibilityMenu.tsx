import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Check } from 'lucide-preact';

/** Viewport coordinates the menu hangs off. */
export interface MenuAnchor {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface VisibilityItem {
  /** A built-in view id, a `plugin:<id>/<panel>` key, or a navbar control id. */
  id: string;
  title: string;
  /** Contributions can be hidden; the surface's fixed furniture cannot. */
  removable: boolean;
}

interface VisibilityMenuProps {
  anchor: MenuAnchor;
  /** The list's heading — "Panels" for a rail, "Navbar" for the header. */
  title?: string;
  items: VisibilityItem[];
  hidden: string[];
  onToggle: (id: string, visible: boolean) => void;
  onClose: () => void;
  /**
   * Which edge of the anchor the menu hangs from.
   *
   * A rail sits on the window's right edge, so its menu opens to the LEFT of
   * the rail. The navbar spans the window, so its menu opens below the header,
   * right-aligned to the header's own right edge.
   */
  align?: 'left' | 'right';
}

/**
 * A right-click menu of checkboxes: which controls a surface shows.
 *
 * The shape is VS Code's, including the part that makes it useful: a control
 * that is hidden does not vanish from this list — it stays here with its
 * checkbox off, which is the only place it can be switched back on. Hiding a
 * control therefore never loses it.
 *
 * Positions itself from its OWN measured size, so the list growing with the
 * installed plugins cannot push the last row off-screen.
 */
export function VisibilityMenu({
  anchor,
  title = 'Panels',
  items,
  hidden,
  onToggle,
  onClose,
  align = 'left',
}: VisibilityMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // DIAG: temporary
  const diagMount = useRef('');
  if (!diagMount.current) diagMount.current = new Error().stack ?? '';
  if (typeof document === 'undefined') console.error('[diag] VisibilityMenu rendered without document\n' + diagMount.current);

  useLayoutEffect(() => {
    const el = menuRef.current;
    const view = el?.ownerDocument.defaultView;
    if (!el || !view) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const below = anchor.bottom + 4;
    const top = below + height + margin <= view.innerHeight ? below : Math.max(margin, anchor.top - height - 4);
    // A rail is on the RIGHT edge, so its menu opens to its left; the navbar
    // spans the window, so its menu is right-aligned to the header's edge.
    const desiredLeft = align === 'left' ? anchor.left - width - 4 : anchor.right - width - 4;
    setPos({ top, left: Math.max(margin, Math.min(desiredLeft, view.innerWidth - width - margin)) });
  }, [anchor, align]);

  // Registered on the menu's OWN document rather than the global: this panel is
  // portalled, so its document is the one it paints into, and the global can be
  // absent by the time a deferred cleanup runs (measured under `bun test`:
  // `ReferenceError: document is not defined` from this effect, reported against
  // a later file).
  useEffect(() => {
    const doc = menuRef.current?.ownerDocument;
    if (!doc) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => doc.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Nothing to portal into means nothing to draw; see `AnchoredMenu`.
  const host = typeof document === 'undefined' ? null : document.body;
  if (!host) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div
        ref={menuRef}
        role="menu"
        aria-label={`${title} visibility`}
        style={{
          top: pos?.top ?? anchor.bottom + 4,
          left: pos?.left ?? anchor.left,
          // Hidden for the single pre-measure render; `useLayoutEffect` settles
          // the position before the browser paints, so this never flashes.
          visibility: pos ? 'visible' : 'hidden',
        }}
        className="glass-popover fixed z-[70] w-52 bg-paper border border-ink/15 rounded-lg shadow-xl py-1 text-xs text-ink font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-1 text-[10px] uppercase font-mono text-ink/40 border-b border-ink/10 mb-1">
          {title}
        </div>
        {items.map((item) => {
          const visible = !hidden.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={visible}
              // A pinned view is the bar's own furniture and has no row to
              // return to if it were removed, so its checkbox is inert rather
              // than a control that appears to work and does nothing.
              disabled={!item.removable}
              onClick={() => onToggle(item.id, !visible)}
              className="w-full text-left px-3 py-1.5 hover:bg-ink/5 flex items-center gap-2 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span className="w-3 flex-shrink-0">
                {visible ? <Check size={12} className={item.removable ? 'text-ink/70' : 'text-ink/30'} /> : null}
              </span>
              <span className={`truncate ${item.removable ? '' : 'text-ink/50'}`}>{item.title}</span>
              {!item.removable ? (
                <span className="ml-auto text-[10px] text-ink/35 flex-shrink-0">pinned</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>,
    host,
  );
}
