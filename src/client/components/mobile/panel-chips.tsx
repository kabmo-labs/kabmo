/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone's panel tab strip — ONE component, drawn by both drawers.
 *
 * A phone has no rail: the desktop's vertical activity bar is a horizontal
 * strip of chips here. The right drawer had this from the start and the left
 * drawer (the session list) did not, so a plugin panel placed on the left was
 * reachable only through the RIGHT drawer's `all` catalog — the placement
 * existed and nothing on the left ever showed it.
 *
 * Both drawers render this, so the two cannot drift in label, active state or
 * the Source Control dot. The strip is scrollable rather than wrapping: a phone
 * drawer is one row tall, and a wrapped strip would eat the list's height.
 *
 * **The active chip is scrolled into view, because a programmatic selection
 * lands off-screen.** A drawer's tab is not only ever set by tapping a chip: the
 * navbar's own readout asks for a panel (`requestOpenPanel`), and the layout
 * writes that key into the drawer's stored tab and opens the screen. On a phone
 * wide enough to hold four of eleven chips, the panel then rendered correctly
 * while its chip sat past the right edge of a strip with NO scrollbar — the
 * drawer looked like it had opened the wrong view, and nothing on screen named
 * the one it had. The reveal runs on the ACTIVE ID, so a tap that lands on a
 * half-visible chip completes the gesture too, and on the panel LIST, because
 * the catalog resolves after mount (a plugin bundle loads lazily) and the chip
 * may not exist on the render the id was stored in.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
import { PluginMark } from '@/client/components/settings/categories/panel-plugins/PluginMark';
import { PANEL_MARK_SIZE } from '@/shared/lib/workspace/right-panels';
import { scrollLeftForReveal } from '@/shared/lib/ui/scroll-reveal';

/** Breathing room left between a revealed chip and the strip's own edge. */
const REVEAL_PAD_PX = 8;

interface PanelChipsProps {
  panels: readonly ResolvedPanel[];
  activeId: string;
  onSelect: (id: string) => void;
  /**
   * Draw the Source Control dot on the `git` chip. The left catalog never holds
   * a built-in view, so only the right drawer passes this.
   */
  hasGitChanges?: boolean;
}

export function PanelChips({ panels, activeId, onSelect, hasGitChanges = false }: PanelChipsProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  // Keyed by panel id rather than an index: the catalog re-orders as panels are
  // placed, so an index-keyed list would point a reveal at the chip that used
  // to be there.
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  // What the strip should reveal, read by the resize path without re-arming it.
  const latest = useRef({ activeId, panels });
  latest.current = { activeId, panels };
  /** The selection + strip width already revealed, so nothing drags it back. */
  const revealedRef = useRef({ signature: '', width: 0 });

  const reveal = useCallback(() => {
    const strip = stripRef.current;
    const chip = chipRefs.current.get(latest.current.activeId);
    // A drawer that is not on screen measures 0 wide: there is nothing to
    // scroll yet, and the observer below runs the reveal when it appears. The
    // LEFT drawer is mounted permanently and hidden with `display: none`, so
    // this is the ordinary case there, not an edge.
    if (!strip || !chip || strip.clientWidth <= 0) return;
    const signature = `${latest.current.activeId}\u0000${latest.current.panels
      .map((panel) => panel.id)
      .join('\u0000')}`;
    const seen = revealedRef.current;
    if (seen.signature === signature && seen.width === strip.clientWidth) return;
    revealedRef.current = { signature, width: strip.clientWidth };

    const stripRect = strip.getBoundingClientRect();
    const chipRect = chip.getBoundingClientRect();
    const next = scrollLeftForReveal(
      {
        scrollLeft: strip.scrollLeft,
        clientWidth: strip.clientWidth,
        scrollWidth: strip.scrollWidth,
        // Measured against the strip's own content start, which is where
        // `scrollLeft` counts from — a chip's `offsetLeft` is relative to
        // whichever ancestor happens to be positioned.
        start: chipRect.left - stripRect.left + strip.scrollLeft,
        size: chipRect.width,
      },
      REVEAL_PAD_PX,
    );
    if (next !== strip.scrollLeft) strip.scrollLeft = next;
  }, []);

  // A new selection, or a chip that has finally resolved: the catalog gains an
  // entry only once a plugin's bundle has loaded, so the id can be stored
  // before there is anything to scroll to.
  useLayoutEffect(reveal, [activeId, panels, reveal]);

  // A WIDTH change is not a selection change, and a strip that overflows only
  // after a rotation or a narrowed shell window has no other signal: the chip
  // that was in view is the last in the catalog, so it is the first to fall off
  // the right edge. Measured on the phone layout, this fires once per resize and
  // the signature check inside `reveal` keeps a scroll the READER made intact —
  // a resize is a change of the strip, not of the choice.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(reveal);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [reveal]);

  return (
    <div ref={stripRef} className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar py-1">
      {panels.map((panel) => {
        const active = panel.id === activeId;
        return (
          <button
            key={panel.id}
            ref={(element) => {
              if (element) chipRefs.current.set(panel.id, element);
              else chipRefs.current.delete(panel.id);
            }}
            type="button"
            onClick={() => onSelect(panel.id)}
            aria-pressed={active}
            // The name is the panel's TITLE, never its visible label. The label
            // only renders while the chip is active, so without this the same
            // button is called "Resources — stats" before a click and
            // "Resources" after it — a control that renames itself when used is
            // unusable to a screen reader and unfindable to a spec.
            aria-label={panel.title}
            className={`relative flex items-center transition-all cursor-pointer ${
              active
                ? 'space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-ink text-canvas shadow-sm'
                : 'p-2 rounded-lg text-ink/70 hover:bg-ink/5'
            }`}
            title={panel.title}
          >
            {panel.builtin ? panel.icon : <PluginMark name={panel.name} iconUrl={panel.iconUrl} size={PANEL_MARK_SIZE} />}
            {active && (
              <span className={panel.id === 'git' ? 'tracking-wide' : undefined}>{panel.label}</span>
            )}
            {panel.id === 'git' && hasGitChanges && (
              <span
                className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-info"
                title="Uncommitted changes"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
