import { useCallback, useState } from 'preact/hooks';
import { BrowserAddressBar } from '@/client/components/workspace/browser-panel/AddressBar';
import { BrowserEngineNotice } from '@/client/components/workspace/browser-panel/EngineNotice';
import { BrowserScreencast } from '@/client/components/workspace/browser-panel/Screencast';
import { useBrowserEngine } from '@/client/hooks/browser/use-browser-engine';
import { useScreencast } from '@/client/hooks/browser/use-screencast';
import { useCloseBrowserTab } from '@/client/hooks/browser/use-close-tab';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { emitBrowserPageContext } from '@/shared/lib/browser/page-context';

interface BrowserPanelProps {
  className?: string;
  /** False while the panel is hidden (desktop right panel / mobile tab): pauses the SSE viewer. */
  active?: boolean;
}

/**
 * Read-only live view of the browser tab this session's omp agent drives in the
 * project-shared Chromium (see app/lib/browser/ + /api/browser/:id/stream).
 *
 * This panel only mirrors what the agent does, with ONE exception: it can CLOSE
 * the session's tabs. The agent opens a page per site and never tidies up, and
 * the viewer follows the newest owned tab — so without a close control a stale
 * page keeps stealing the panel.
 *
 * Interactive browsing belongs to the separate user-browser panel, which runs
 * its own private Chromium.
 *
 * There is deliberately NO device/viewport selector here: the surface is a
 * fixed-resolution screencast JPEG, so a preset could only letterbox the image
 * while claiming to emulate a device. Emulation belongs to the agent itself
 * (`tab.emulate()` / `browser.open({ viewport })`); the user-browser panel,
 * whose iframe's layout viewport *is* its CSS box, keeps the selector.
 */
export function BrowserPanel({ className = '', active = true }: BrowserPanelProps) {
  const [zoomLevel, setZoomLevel] = useSessionState<number>('browser.zoomLevel', 100);
  const { status, url, title, tabs, targetId, frame, actions, sessionId, selectTarget, reconnect } = useScreencast(active);
  const { closeTab, closing } = useCloseBrowserTab(sessionId);
  const engine = useBrowserEngine();
  const [closeError, setCloseError] = useState<string | null>(null);

  // A WebKit session can never produce a frame here (no CDP, no screencast), so
  // the panel explains the engine instead of waiting. `mock` is excluded: the
  // stream is offline there for a different reason.
  const webkitActive = engine.state?.effective === 'webkit' && !engine.state.mock;
  const engineExplainsEmptyView = webkitActive && (status === 'browser-offline' || status === 'no-tab');

  const handleUseChromium = useCallback(() => {
    void engine.useChromium().then((ok) => {
      if (ok) reconnect();
    });
  }, [engine.useChromium, reconnect]);

  const handleOpenExternal = () => {
    if (!url) return;
    const target =
      url.startsWith('/') && typeof window !== 'undefined' ? `${window.location.origin}${url}` : url;
    window.open(target, '_blank', 'noopener,noreferrer');
  };

  const handleIncludeInChat = useCallback(() => {
    if (!url) return;
    emitBrowserPageContext({ url, title });
  }, [url, title]);

  // Closing a tab re-points the viewer at the neighbour the server named. The
  // empty string means "follow the newest owned tab"; a real id pins it so the
  // strip does not jump to an unrelated page.
  const handleCloseTarget = useCallback(
    (closingTarget: string) => {
      if (closing === closingTarget) return;
      void closeTab(closingTarget).then((result) => {
        if (!result.ok) {
          setCloseError(result.error ?? 'The tab could not be closed');
          return;
        }
        setCloseError(null);
        selectTarget(result.next ?? '');
      });
    },
    [closeTab, closing, selectTarget],
  );

  return (
    <div className={`flex flex-col h-full w-full bg-paper text-ink overflow-hidden select-none ${className}`}>
      <BrowserAddressBar
        url={url}
        status={status}
        zoomLevel={zoomLevel}
        onIncludeInChat={handleIncludeInChat}
        onReconnect={reconnect}
        onOpenExternal={handleOpenExternal}
        onZoomIn={() => setZoomLevel((prev) => Math.min(200, prev + 10))}
        onZoomOut={() => setZoomLevel((prev) => Math.max(50, prev - 10))}
        onResetZoom={() => setZoomLevel(100)}
      />

      {closeError && (
        <div
          role="alert"
          className="px-2.5 py-1 border-b border-error/30 bg-error/5 text-[11px] text-error flex items-center justify-between gap-2 flex-shrink-0"
        >
          <span className="truncate" title={closeError}>
            {closeError}
          </span>
          <button
            type="button"
            onClick={() => setCloseError(null)}
            className="text-[10px] uppercase tracking-wide text-error/80 hover:text-error cursor-pointer flex-shrink-0"
          >
            Tutup
          </button>
        </div>
      )}

      {webkitActive && status === 'live' && engine.state && (
        <BrowserEngineNotice
          saving={engine.saving}
          error={engine.error}
          onUseChromium={handleUseChromium}
          variant="strip"
        />
      )}

      {engineExplainsEmptyView && engine.state ? (
        <BrowserEngineNotice
          saving={engine.saving}
          error={engine.error}
          onUseChromium={handleUseChromium}
          variant="body"
        />
      ) : (
        <BrowserScreencast
          status={status}
          url={url}
          tabs={tabs}
          targetId={targetId}
          frame={frame}
          actions={actions}
          onSelectTarget={selectTarget}
          onCloseTarget={handleCloseTarget}
          closingTarget={closing}
          zoomLevel={zoomLevel}
        />
      )}
    </div>
  );
}
