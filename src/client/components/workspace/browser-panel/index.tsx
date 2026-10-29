import { useCallback } from 'preact/hooks';
import { BrowserAddressBar } from '@/client/components/workspace/browser-panel/AddressBar';
import { BrowserScreencast } from '@/client/components/workspace/browser-panel/Screencast';
import { useScreencast } from '@/client/hooks/browser/use-screencast';
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
 * This panel only mirrors what the agent does. Interactive browsing belongs to
 * the separate user-browser panel, which runs its own private Chromium.
 *
 * There is deliberately NO device/viewport selector here: the surface is a
 * fixed-resolution screencast JPEG, so a preset could only letterbox the image
 * while claiming to emulate a device. Emulation belongs to the agent itself
 * (`tab.emulate()` / `browser.open({ viewport })`); the user-browser panel,
 * whose iframe's layout viewport *is* its CSS box, keeps the selector.
 */
export function BrowserPanel({ className = '', active = true }: BrowserPanelProps) {
  const [zoomLevel, setZoomLevel] = useSessionState<number>('browser.zoomLevel', 100);
  const { status, url, title, tabs, targetId, frame, actions, selectTarget, reconnect } = useScreencast(active);

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

      <BrowserScreencast
        status={status}
        url={url}
        tabs={tabs}
        targetId={targetId}
        frame={frame}
        actions={actions}
        onSelectTarget={selectTarget}
        zoomLevel={zoomLevel}
      />
    </div>
  );
}
