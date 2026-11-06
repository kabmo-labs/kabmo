import {
  Check,
  Copy,
  ExternalLink,
  MessageSquarePlus,
  RotateCcw,
  RotateCw,
  SquarePen,
  ZoomIn,
  ZoomOut,
} from 'lucide-preact';
import { BrowserViewportSelector, VIEWPORT_OPTIONS } from '@/client/components/common/ViewportSelector';
import { ZoomControls } from '@/client/components/workspace/browser-toolbar/ZoomControls';
import type { ToolbarCluster } from '@/client/components/common/toolbar-row';
import type { ViewportMode } from '@/shared/types';

/** Class the browser toolbars' icon buttons share. */
export const ICON_BUTTON =
  'p-1.5 rounded hover:bg-ink/5 disabled:opacity-25 disabled:hover:bg-transparent text-ink/70 hover:text-ink transition-colors cursor-pointer disabled:cursor-not-allowed';

/** The user panel's annotation toggle; the agent panel never supplies it. */
export interface BrowserToolbarAnnotate {
  active: boolean;
  count: number;
  onToggle: () => void;
}

export interface BrowserClusterInput {
  url: string;
  zoomLevel: number;
  /** True for the 2s after the URL was copied — the button and menu row say so. */
  copied: boolean;
  /** True for the 2.5s after the page context was queued into the draft. */
  included: boolean;
  /** Device-testing cluster, user panel only (see `BrowserToolbarProps`). */
  viewportMode?: ViewportMode;
  onChangeViewport?: (mode: ViewportMode) => void;
  /** Annotation toggle, user panel only. */
  annotate?: BrowserToolbarAnnotate;
  /** Agent panel only: re-attach the live view. */
  onReconnect?: () => void;
  onIncludeInChat: () => void;
  onCopy: () => void;
  onOpenExternal: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onSetZoom?: (zoom: number) => void;
  openExternalLabel: string;
  openExternalTitle: string;
}

/**
 * The browser toolbars' trailing controls, as clusters that hide as a unit.
 *
 * ROW ORDER IS HIDING ORDER for `ToolbarRow`: the first clusters stay longest,
 * and everything after the last one that fits moves into `⋯` with the same
 * action it would have run on the row. The address bar is NOT a cluster — it is
 * outside the row and always drawn, because an address field behind a menu is
 * the one control this toolbar cannot do without.
 *
 * Nothing here is pinned. The panel can be dragged down to a phone width, and
 * at that point a row that refuses to give up a control is a row that clips it.
 */
export function buildBrowserClusters(input: BrowserClusterInput): ToolbarCluster[] {
  const clusters: ToolbarCluster[] = [];
  const { url, zoomLevel, copied, included } = input;

  if (input.viewportMode && input.onChangeViewport) {
    const { viewportMode, onChangeViewport, onSetZoom } = input;
    clusters.push({
      id: 'viewport',
      actions: VIEWPORT_OPTIONS.map((option) => ({
        label: option.label,
        icon: option.icon,
        onSelect: () => onChangeViewport(option.id),
        active: viewportMode === option.id,
      })),
      children: (
        <BrowserViewportSelector
          viewportMode={viewportMode}
          onChangeViewport={onChangeViewport}
          zoomLevel={zoomLevel}
          onSetZoom={onSetZoom}
        />
      ),
    });
  }

  clusters.push({
    id: 'zoom',
    actions: [
      { label: 'Zoom in (+10%)', icon: ZoomIn, onSelect: input.onZoomIn, disabled: zoomLevel >= 200 },
      { label: 'Zoom out (-10%)', icon: ZoomOut, onSelect: input.onZoomOut, disabled: zoomLevel <= 50 },
      { label: 'Reset zoom (100%)', icon: RotateCcw, onSelect: input.onResetZoom, active: zoomLevel === 100 },
    ],
    children: (
      <ZoomControls
        zoomLevel={zoomLevel}
        onZoomIn={input.onZoomIn}
        onZoomOut={input.onZoomOut}
        onResetZoom={input.onResetZoom}
      />
    ),
  });

  clusters.push({
    id: 'include',
    actions: [
      {
        label: included ? 'Page context added to the draft' : 'Include this page in the chat draft',
        icon: MessageSquarePlus,
        onSelect: input.onIncludeInChat,
        disabled: !url,
      },
    ],
    children: (
      <button
        type="button"
        onClick={input.onIncludeInChat}
        disabled={!url}
        aria-label="Include this page in the chat draft"
        title={included ? 'Page context added to the draft' : 'Include this page in the chat draft'}
        className={ICON_BUTTON}
      >
        {included ? <Check size={14} className="text-success" /> : <MessageSquarePlus size={14} />}
      </button>
    ),
  });

  if (input.annotate) {
    const annotate = input.annotate;
    clusters.push({
      id: 'annotate',
      actions: [
        {
          label:
            annotate.count > 0
              ? `${annotate.active ? 'Tutup mode anotasi' : 'Buka mode anotasi'} (${annotate.count})`
              : 'Mark a part of the page, then send it to the chat',
          icon: SquarePen,
          onSelect: annotate.onToggle,
          active: annotate.active,
          disabled: !url,
        },
      ],
      children: (
        <button
          type="button"
          onClick={annotate.onToggle}
          disabled={!url}
          aria-label="Page annotation mode"
          aria-pressed={annotate.active}
          title={
            annotate.active
              ? 'Tutup mode anotasi'
              : annotate.count > 0
                ? `Anotasi (${annotate.count}) — buka lagi`
                : 'Mark a part of the page, then send it to the chat'
          }
          className={`${ICON_BUTTON} relative ${annotate.active ? 'bg-ink/10 text-ink' : ''}`}
        >
          <SquarePen size={14} />
          {annotate.count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-error text-paper text-[10px] leading-[13px] font-mono text-center">
              {annotate.count}
            </span>
          )}
        </button>
      ),
    });
  }

  clusters.push({
    id: 'copy',
    actions: [
      { label: copied ? 'Copied URL!' : 'Copy URL', icon: Copy, onSelect: input.onCopy, disabled: !url },
    ],
    children: (
      <button
        type="button"
        onClick={input.onCopy}
        disabled={!url}
        aria-label="Salin URL"
        title={copied ? 'Copied URL!' : 'Copy URL'}
        className={ICON_BUTTON}
      >
        {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
      </button>
    ),
  });

  if (input.onReconnect) {
    const onReconnect = input.onReconnect;
    clusters.push({
      id: 'reconnect',
      actions: [{ label: 'Sambungkan ulang live view', icon: RotateCw, onSelect: onReconnect }],
      children: (
        <button
          type="button"
          onClick={onReconnect}
          aria-label="Sambungkan ulang live view"
          title="Reconnect live view"
          className={ICON_BUTTON}
        >
          <RotateCw size={14} />
        </button>
      ),
    });
  }

  clusters.push({
    id: 'open-external',
    actions: [
      {
        label: input.openExternalLabel,
        icon: ExternalLink,
        onSelect: input.onOpenExternal,
        disabled: !url,
      },
    ],
    children: (
      <button
        type="button"
        onClick={input.onOpenExternal}
        disabled={!url}
        aria-label={input.openExternalLabel}
        title={input.openExternalTitle}
        className={ICON_BUTTON}
      >
        <ExternalLink size={14} />
      </button>
    ),
  });

  return clusters;
}
