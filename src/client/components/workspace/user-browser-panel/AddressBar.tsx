import { useEffect, useRef } from 'preact/hooks';
import { ArrowLeft, ArrowRight, Globe, RefreshCw } from 'lucide-preact';
import { BrowserToolbar } from '@/client/components/workspace/browser-toolbar/index';
import type { BrowserToolbarAnnotate } from '@/client/components/workspace/browser-toolbar/index';
import type { ViewportMode } from '@/shared/types';

interface UserBrowserAddressBarProps {
  url: string;
  input: string;
  loading: boolean;
  error?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  viewportMode: ViewportMode;
  zoomLevel: number;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onOpenExternal: () => void;
  onIncludeInChat: () => void;
  onChangeViewport: (mode: ViewportMode) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onSetZoom: (zoom: number) => void;
  /** Annotation toggle — this panel is the only one that offers it. */
  annotate?: BrowserToolbarAnnotate;
}

type UserBrowserPhase = 'idle' | 'loading' | 'ready';

const PHASE_LABEL: Record<UserBrowserPhase, string> = {
  idle: 'Kosong',
  loading: 'Memuat',
  ready: 'Siap',
};

const NAV_BUTTON =
  'p-1 rounded hover:bg-ink/5 disabled:opacity-25 disabled:hover:bg-transparent text-ink/70 hover:text-ink cursor-pointer disabled:cursor-not-allowed transition-colors';

/** Toolbar for the user's iframe browser: status, history, address, and display controls. */
export function UserBrowserAddressBar({
  url,
  input,
  loading,
  error,
  canGoBack,
  canGoForward,
  viewportMode,
  zoomLevel,
  onInputChange,
  onSubmit,
  onBack,
  onForward,
  onReload,
  onOpenExternal,
  onIncludeInChat,
  onChangeViewport,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onSetZoom,
  annotate,
}: UserBrowserAddressBarProps) {
  const followedRef = useRef<string | undefined>(undefined);

  // Mirror the loaded URL into the field, but never overwrite active typing.
  useEffect(() => {
    if (followedRef.current === url) return;
    followedRef.current = url;
    if (url) onInputChange(url);
  }, [url, onInputChange]);

  const phase: UserBrowserPhase = !url ? 'idle' : loading ? 'loading' : 'ready';
  const dotClass =
    phase === 'ready' ? 'bg-success animate-pulse' : phase === 'loading' ? 'bg-ink/40 animate-pulse' : 'bg-ink/25';

  const navControls = (
    <div className="flex items-center bg-canvas border border-ink/10 rounded-md p-0.5 space-x-0.5 flex-shrink-0">
      <button type="button" onClick={onBack} disabled={!canGoBack} aria-label="Back" title="Back" className={NAV_BUTTON}>
        <ArrowLeft size={12} />
      </button>
      <button type="button" onClick={onForward} disabled={!canGoForward} aria-label="Maju" title="Maju" className={NAV_BUTTON}>
        <ArrowRight size={12} />
      </button>
      <button type="button" onClick={onReload} disabled={!url} aria-label="Reload" title="Reload" className={NAV_BUTTON}>
        <RefreshCw size={12} className={loading ? 'animate-spin' : undefined} />
      </button>
    </div>
  );

  return (
    <BrowserToolbar
      url={url}
      statusDotClass={dotClass}
      statusLabel={PHASE_LABEL[phase]}
      viewportMode={viewportMode}
      zoomLevel={zoomLevel}
      onChangeViewport={onChangeViewport}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onResetZoom={onResetZoom}
      onSetZoom={onSetZoom}
      annotate={annotate}
      onIncludeInChat={onIncludeInChat}
      onOpenExternal={onOpenExternal}
      openExternalLabel="Buka di tab baru"
      openExternalTitle="Buka di tab baru (untuk situs yang menolak iframe)"
    >
      <div className="flex items-center flex-1 min-w-0 space-x-1.5">
        {navControls}
        <form
          className={`flex-1 min-w-0 flex items-center bg-canvas border rounded-md px-2 py-0.5 space-x-1 focus-within:border-ink/40 ${error ? 'border-error' : 'border-ink/15'}`}
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(input);
          }}
        >
          <Globe size={12} className="text-ink/40 flex-shrink-0" />
          <input
            type="text"
            value={input}
            onChange={(event) => onInputChange(event.currentTarget.value)}
            placeholder="Type an address (e.g. localhost:5173) and press Enter…"
            aria-label="Browser address"
            aria-invalid={error !== undefined && error !== null}
            title={error ?? undefined}
            spellcheck={false}
            autoComplete="off"
            className={`w-full min-w-0 bg-transparent outline-none font-mono text-[11px] placeholder:text-ink/35 ${error ? 'text-error' : 'text-ink/90'}`}
          />
        </form>
      </div>
    </BrowserToolbar>
  );
}

