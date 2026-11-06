import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ToolbarRow } from '@/client/components/common/toolbar-row';
import { buildBrowserClusters } from '@/client/components/workspace/browser-toolbar/clusters';
import type { BrowserToolbarAnnotate } from '@/client/components/workspace/browser-toolbar/clusters';
import type { ComponentChildren } from 'preact';
import type { ViewportMode } from '@/shared/types';

export type { BrowserToolbarAnnotate };

/** Width the status cluster is allowed at most; it shrinks away first. */
const STATUS_MAX_PX = 108;
/** Below this bar width the status label is dropped and only its dot stays. */
const STATUS_LABEL_MIN_BAR_PX = 280;
/** The status dot plus its gap. */
const STATUS_DOT_PX = 18;
/**
 * Width the address slot keeps before the trailing row gives anything up. The
 * user panel's slot also carries its Back/Forward/Reload cluster (~76px), so
 * this is what is left for the field itself once that cluster is drawn.
 */
const ADDRESS_MIN_PX = 140;
/** The bar's own `px-2.5` (20px) plus both `gap-x-2` (2 × 8px). */
const BAR_CHROME_PX = 36;

export interface BrowserToolbarProps {
  url: string;
  /** Status dot class plus its label — the only per-panel difference. */
  statusDotClass: string;
  statusLabel: string;
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onIncludeInChat: () => void;
  onOpenExternal: () => void;
  /**
   * Device-testing cluster, rendered only when both are supplied. The USER
   * panel passes them: its iframe's layout viewport *is* its CSS box, so a
   * preset genuinely re-runs the page's media queries. The AGENT panel omits
   * them — its surface is a fixed-resolution screencast JPEG, so a preset
   * could only letterbox the image while claiming to emulate a device.
   */
  viewportMode?: ViewportMode;
  onChangeViewport?: (mode: ViewportMode) => void;
  onSetZoom?: (zoom: number) => void;
  /**
   * Annotation mode, rendered only when supplied. The USER panel passes it: its
   * marks are normalized against a measured iframe box. The AGENT panel does
   * not — its surface is the agent's own live view, so the user annotates the
   * page by asking the agent instead of drawing on a JPEG.
   */
  annotate?: BrowserToolbarAnnotate;
  /** Agent panel only: re-attach the live view. Drawn inside the trailing row. */
  onReconnect?: () => void;
  /** Open-external button label/title, differing between the two panels. */
  openExternalLabel: string;
  openExternalTitle: string;
  /** The middle slot: read-only URL text, or the nav cluster + editable form. */
  children: ComponentChildren;
}

/**
 * Shared address bar for both browser panels.
 *
 * THREE regions, and only the first and third give ground:
 *
 * 1. The status cluster, capped at {@link STATUS_MAX_PX} (and shrinking below
 *    that on a very narrow bar) so it can never crowd out the address slot.
 * 2. The middle slot — the address field — `flex-1 min-w-0`. It is drawn at
 *    EVERY width and is never a `⋯` candidate: an address bar behind a menu is
 *    the one control this toolbar cannot do without. At the narrowest the panel
 *    allows, the field's text truncates but the field itself stays.
 * 3. The trailing controls, in a `ToolbarRow`, whose overflow rule moves what
 *    does not fit into `⋯` and keeps it one click away. The row is given the
 *    bar's remaining width as its budget, so as the panel is dragged narrower
 *    the controls surrender space — right-to-left in row order — and the
 *    address slot keeps {@link ADDRESS_MIN_PX} until they are all in the menu.
 */
export function BrowserToolbar({
  url,
  statusDotClass,
  statusLabel,
  viewportMode,
  zoomLevel,
  onChangeViewport,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onSetZoom,
  annotate,
  onIncludeInChat,
  onOpenExternal,
  onReconnect,
  openExternalLabel,
  openExternalTitle,
  children,
}: BrowserToolbarProps) {
  const [copied, setCopied] = useState(false);
  const [included, setIncluded] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = useState(0);

  const handleCopy = () => {
    if (!url) return;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  const handleInclude = () => {
    onIncludeInChat();
    setIncluded(true);
    setTimeout(() => setIncluded(false), 2500);
  };

  const clusters = buildBrowserClusters({
    url,
    zoomLevel,
    copied,
    included,
    viewportMode,
    onChangeViewport,
    annotate,
    onReconnect,
    onIncludeInChat: handleInclude,
    onCopy: handleCopy,
    onOpenExternal,
    onZoomIn,
    onZoomOut,
    onResetZoom,
    onSetZoom,
    openExternalLabel,
    openExternalTitle,
  });

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    setBarWidth(bar.clientWidth);
  });

  // The bar's width changes on a window resize, a panel drag and a layout mode
  // switch — none of which are `window` events.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setBarWidth(bar.clientWidth));
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const showStatusLabel = barWidth === 0 || barWidth >= STATUS_LABEL_MIN_BAR_PX;
  const statusMax = showStatusLabel
    ? barWidth > 0
      ? Math.min(STATUS_MAX_PX, barWidth * 0.25)
      : STATUS_MAX_PX
    : STATUS_DOT_PX;
  const tailBudget =
    barWidth > 0 ? Math.max(0, barWidth - statusMax - ADDRESS_MIN_PX - BAR_CHROME_PX) : undefined;

  return (
    <div
      ref={barRef}
      data-browser-toolbar=""
      className="h-10 px-2.5 border-b border-ink/10 bg-paper flex items-center gap-x-2 flex-shrink-0 select-none"
    >
      <div
        className="flex items-center space-x-1.5 flex-shrink-0 min-w-0"
        style={{ maxWidth: `${statusMax}px` }}
        title={statusLabel}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotClass}`} />
        {showStatusLabel && (
          <span className="text-[10px] font-mono uppercase tracking-wide text-ink/60 truncate">{statusLabel}</span>
        )}
      </div>

      {/* Never a cluster: `flex-1 min-w-0` in the bar means it is drawn at every
          width and takes the space the trailing controls give up. */}
      <div className="flex flex-1 min-w-0 items-center">{children}</div>

      <ToolbarRow clusters={clusters} available={tailBudget} />
    </div>
  );
}
