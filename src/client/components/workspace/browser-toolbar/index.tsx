import { useState } from 'preact/hooks';
import { Check, Copy, ExternalLink, MessageSquarePlus, SquarePen } from 'lucide-preact';
import { BrowserViewportSelector } from '@/client/components/common/ViewportSelector';
import { ZoomControls } from '@/client/components/workspace/browser-toolbar/ZoomControls';
import type { ComponentChildren } from 'preact';
import type { ViewportMode } from '@/shared/types';

export const ICON_BUTTON =
  'p-1.5 rounded hover:bg-ink/5 disabled:opacity-25 disabled:hover:bg-transparent text-ink/70 hover:text-ink transition-colors cursor-pointer disabled:cursor-not-allowed';

/** The user panel's annotation toggle; the agent panel never supplies it. */
export interface BrowserToolbarAnnotate {
  active: boolean;
  count: number;
  onToggle: () => void;
}

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
  /** Shown after the include/copy buttons — the agent panel's reconnect button. */
  trailingControls?: ComponentChildren;
  /** Open-external button label/title, differing between the two panels. */
  openExternalLabel: string;
  openExternalTitle: string;
  /** The middle slot: read-only URL text, or the nav cluster + editable form. */
  children: ComponentChildren;
}

/**
 * Shared address bar for both browser panels. The two panels differ only in
 * their status semantics, the middle slot (read-only URL vs editable form),
 * the agent panel's reconnect button, and whether the device-testing cluster
 * is offered at all (user panel yes, agent panel no — see `viewportMode`);
 * everything else — the include, copy, open-external buttons and the zoom
 * cluster — lives here so the two toolbars cannot drift.
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
  trailingControls,
  openExternalLabel,
  openExternalTitle,
  children,
}: BrowserToolbarProps) {
  const [copied, setCopied] = useState(false);
  const [included, setIncluded] = useState(false);

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

  return (
    <div className="h-10 px-2.5 border-b border-ink/10 bg-paper flex items-center justify-between flex-shrink-0 select-none space-x-2">
      <div className="flex items-center space-x-1.5 flex-shrink-0" title={statusLabel}>
        <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass}`} />
        <span className="text-[10px] font-mono uppercase tracking-wide text-ink/60">{statusLabel}</span>
      </div>

      {children}

      <div className="flex items-center space-x-1.5 flex-shrink-0">
        {viewportMode && onChangeViewport && (
          <BrowserViewportSelector
            viewportMode={viewportMode}
            onChangeViewport={onChangeViewport}
            zoomLevel={zoomLevel}
            onSetZoom={onSetZoom}
          />
        )}

        <ZoomControls
          zoomLevel={zoomLevel}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onResetZoom={onResetZoom}
        />

        <button
          type="button"
          onClick={handleInclude}
          disabled={!url}
          aria-label="Include this page in the chat draft"
          title={included ? 'Page context added to the draft' : 'Include this page in the chat draft'}
          className={ICON_BUTTON}
        >
          {included ? <Check size={14} className="text-success" /> : <MessageSquarePlus size={14} />}
        </button>

        {annotate && (
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
        )}

        <button
          type="button"
          onClick={handleCopy}
          disabled={!url}
          aria-label="Salin URL"
          title={copied ? 'Copied URL!' : 'Copy URL'}
          className={ICON_BUTTON}
        >
          {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
        </button>

        {trailingControls}

        <button
          type="button"
          onClick={onOpenExternal}
          disabled={!url}
          aria-label={openExternalLabel}
          title={openExternalTitle}
          className={ICON_BUTTON}
        >
          <ExternalLink size={14} />
        </button>
      </div>
    </div>
  );
}
