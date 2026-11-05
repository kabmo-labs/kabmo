import { useEffect, useRef, useState } from 'preact/hooks';
import { Globe, Loader2, Radio } from 'lucide-preact';
import { ActivityToasts } from '@/client/components/workspace/browser-panel/ActivityToasts';
import { BrowserTabStrip } from '@/client/components/workspace/browser-panel/TabStrip';
import { drawFrame } from '@/client/lib/browser/frame-canvas';
import type { BrowserPanelAction, BrowserTabInfo, BrowserViewStatus } from '@/shared/types';

interface BrowserScreencastProps {
  status: BrowserViewStatus;
  url?: string;
  tabs: BrowserTabInfo[];
  targetId?: string;
  /** The newest frame; painted into a canvas, never into an `<img>`. */
  frame?: { data: string; mimeType: string } | null;
  actions: BrowserPanelAction[];
  onSelectTarget: (targetId: string) => void;
  /** Close one of the session's tabs; only the strip offers it. */
  onCloseTarget: (targetId: string) => void;
  /** Tab whose close request is in flight. */
  closingTarget?: string | null;
  zoomLevel: number;
}

const OFFLINE_COPY: Record<Exclude<BrowserViewStatus, 'live'>, { title: string; body: string }> = {
  'agent-offline': {
    title: 'The agent is not running',
    body: 'Start this session so the agent can drive the browser.',
  },
  'browser-offline': {
    title: 'No browser is open',
    body: 'Ask the agent to open a page; the live view appears here.',
  },
  'no-tab': {
    title: 'Browser is open, with no tab yet',
    body: 'This session has not opened a tab in the shared browser.',
  },
};

export function BrowserScreencast({
  status,
  url,
  tabs,
  targetId,
  frame,
  actions,
  onSelectTarget,
  onCloseTarget,
  closingTarget,
  zoomLevel,
}: BrowserScreencastProps) {
  const isLive = status === 'live';
  const offline = isLive ? null : OFFLINE_COPY[status];
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Whether a frame has ever been painted. State, not a ref: the placeholder
  // has to leave the DOM on the same commit the canvas gets its first pixels.
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame) return;
    let cancelled = false;
    void drawFrame(canvas, frame.data, frame.mimeType).then((painted) => {
      if (painted && !cancelled) setHasFrame(true);
    });
    return () => {
      cancelled = true;
    };
  }, [frame]);

  // A session switch or a closed tab must not leave the previous page's pixels
  // on screen under a "waiting" spinner.
  useEffect(() => {
    if (!isLive) setHasFrame(false);
  }, [isLive]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-canvas/60 relative overflow-hidden">
      <ActivityToasts actions={actions} />
      {/* Tab strip: the selector needs two tabs, but the CLOSE control is the
          point of the strip — a single leftover page must be closable too. */}
      {isLive && tabs.length > 0 && (
        <BrowserTabStrip
          tabs={tabs}
          targetId={targetId}
          closing={closingTarget}
          onSelectTarget={onSelectTarget}
          onCloseTarget={onCloseTarget}
        />
      )}

      <div className="flex-1 flex items-center justify-center p-2 min-h-0 overflow-auto">
        {isLive ? (
          // Always fills the panel: the surface is a fixed-resolution JPEG, so
          // there is no device box to frame it in — only the zoom scale.
          <div
            className="relative flex flex-col bg-paper w-full h-full transition-all duration-200"
            style={{
              zoom: zoomLevel !== 100 ? `${zoomLevel}%` : undefined,
              transformOrigin: 'top center',
            }}
          >
            {/* A canvas, not an `<img>`: WebKit keeps the decoded image of every
                replaced `src` — measured 76 KB of WebContent footprint per frame,
                gigabytes over a long session. See `frame-canvas.ts`. */}
            <canvas
              ref={canvasRef}
              aria-label={url || 'Live browser view'}
              className={`w-full h-full object-contain bg-paper ${hasFrame ? '' : 'hidden'}`}
            />
            {!hasFrame && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 select-none">
                <Loader2 size={20} className="animate-spin text-ink/40 mb-2" />
                <p className="text-xs text-ink/60">Menunggu frame pertama dari browser…</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none my-auto">
            <div className="w-12 h-12 rounded-xl bg-ink/5 border border-ink/10 flex items-center justify-center text-ink/40 mb-3">
              {status === 'agent-offline' ? <Radio size={24} /> : <Globe size={24} />}
            </div>
            <h3 className="text-sm font-semibold text-ink mb-1">{offline?.title}</h3>
            <p className="text-xs text-ink/60 max-w-sm">{offline?.body}</p>
          </div>
        )}
      </div>
    </div>
  );
}
