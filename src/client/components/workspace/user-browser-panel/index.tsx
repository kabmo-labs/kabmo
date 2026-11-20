import { useCallback, useState } from 'preact/hooks';
import { UserBrowserAddressBar } from '@/client/components/workspace/user-browser-panel/AddressBar';
import { UserBrowserFrame } from '@/client/components/workspace/user-browser-panel/Frame';
import { UserBrowserTabStrip } from '@/client/components/workspace/user-browser-panel/TabStrip';
import { AnnotateBar } from '@/client/components/workspace/user-browser-panel/AnnotateBar';
import { AnnotateLayer } from '@/client/components/workspace/user-browser-panel/AnnotateLayer';
import { useUserBrowser } from '@/client/hooks/browser/use-user-browser';
import { elementAtPoint, type ElementAtResult } from '@/client/lib/browser/element-at';
import { useAnnotate } from '@/client/hooks/browser/use-annotate';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { emitBrowserPageContext } from '@/shared/lib/browser/page-context';
import type { AnnotateShape, ViewportMode } from '@/shared/types';

interface UserBrowserPanelProps {
  className?: string;
  /** False while the panel is hidden: pauses the iframe's live loading. */
  active?: boolean;
}

/**
 * The user's own browser: a plain iframe, so scrolling, clicking, typing, and
 * logins are the browser's native behaviour and cost nothing on our side.
 *
 * It is private to the user — the omp agent has no handle to this frame. Sites
 * that forbid embedding (Google, GitHub) show an empty frame; the toolbar's
 * open-in-new-tab action is the escape hatch for those.
 *
 * Annotating it therefore hands the agent GEOMETRY, not a picture: the page is
 * cross-origin, so nothing here can read or paint it (see `shared/lib/browser/annotate.ts`).
 */
export function UserBrowserPanel({ className = '', active = true }: UserBrowserPanelProps) {
  const [viewportMode, setViewportMode] = useSessionState<ViewportMode>('userBrowser.viewportMode', 'responsive');
  const [zoomLevel, setZoomLevel] = useSessionState<number>('userBrowser.zoomLevel', 100);
  const [panelSize, setPanelSize] = useState<{ width: number; height: number } | null>(null);
  // The frame the marks are drawn over, needed to read the element under one.
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  // How the LAST lookup went, so the bar can say why a mark has no element.
  const [readability, setReadability] = useState<ElementAtResult | null>(null);
  const {
    tabs,
    activeTabId,
    url,
    input,
    setInput,
    loading,
    error,
    canGoBack,
    canGoForward,
    canOpenTab,
    submit,
    goBack,
    goForward,
    reload,
    markLoaded,
    openTab,
    selectTab,
    closeTab,
  } = useUserBrowser();
  // Marks belong to the PAGE, so the key is the tab AND its load counter: a
  // reload clears them, a tab switch moves them to that tab's (empty) set.
  const annotate = useAnnotate(`${activeTabId ?? ''}:${tabs.find((tab) => tab.id === activeTabId)?.frameKey ?? 0}`);

  const handleOpenExternal = useCallback(() => {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [url]);

  const handleIncludeInChat = useCallback(() => {
    if (!url) return;
    emitBrowserPageContext({ url });
  }, [url]);

  const handleMeasure = useCallback((size: { width: number; height: number }) => {
    setPanelSize((prev) => (prev && prev.width === size.width && prev.height === size.height ? prev : size));
  }, []);

  // The element is resolved at the mark's own anchor, the moment it is drawn:
  // the page can change under a mark, and a lookup deferred to Send would
  // describe whatever the page became, not what the user pointed at. A frame
  // that is not same-origin answers a reason instead, and the bar states it.
  const handleAddShape = useCallback((shape: AnnotateShape) => {
    const resolution = elementAtPoint(frame, shape.start);
    setReadability(resolution);
    annotate.add(resolution.ok ? { ...shape, element: resolution.element } : shape);
  }, [annotate, frame]);

  // The marks travel with the panel box they were normalized against: `12%` of
  // a laptop and `12%` of a phone are different places, and CSS zoom is undone
  // here so the agent receives the page's own size rather than the display's.
  const handleSendAnnotations = useCallback(() => {
    if (!url || annotate.shapes.length === 0) return;
    const scale = zoomLevel / 100;
    emitBrowserPageContext({
      url,
      annotations: annotate.shapes,
      panel: {
        width: (panelSize?.width ?? 0) / scale,
        height: (panelSize?.height ?? 0) / scale,
        viewportMode,
        zoom: zoomLevel,
      },
    });
    annotate.close();
  }, [url, annotate, panelSize, viewportMode, zoomLevel]);

  const annotateActive = annotate.active && Boolean(url);

  const loadingTabId = loading ? (activeTabId ?? null) : null;

  return (
    <div
      data-user-browser-panel=""
      className={`flex flex-col h-full w-full bg-paper text-ink overflow-hidden ${className}`}
    >
      {/* The strip is above the bar, as in every browser: it maps what is open,
          the bar describes the active tab. Drawn from one tab upward, because
          `+` must stay reachable even when the last tab was closed. */}
      <UserBrowserTabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        canOpenTab={canOpenTab}
        onSelect={selectTab}
        onClose={closeTab}
        onNewTab={openTab}
      />
      <UserBrowserAddressBar
        url={url}
        input={input}
        loading={loading}
        error={error}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        viewportMode={viewportMode}
        zoomLevel={zoomLevel}
        onInputChange={setInput}
        onSubmit={submit}
        onBack={goBack}
        onForward={goForward}
        onReload={reload}
        onOpenExternal={handleOpenExternal}
        onIncludeInChat={handleIncludeInChat}
        onChangeViewport={setViewportMode}
        onZoomIn={() => setZoomLevel((prev) => Math.min(200, prev + 10))}
        onZoomOut={() => setZoomLevel((prev) => Math.max(50, prev - 10))}
        onResetZoom={() => setZoomLevel(100)}
        onSetZoom={setZoomLevel}
        focusKey={activeTabId ?? undefined}
        annotate={{
          active: annotateActive,
          count: annotate.shapes.length,
          onToggle: annotate.toggle,
        }}
      />
      {annotateActive && (
        <AnnotateBar
          tool={annotate.tool}
          shapes={annotate.shapes}
          selectedId={annotate.selectedId}
          readability={readability}
          onTool={annotate.setTool}
          onLabel={annotate.setLabel}
          onNote={annotate.setNote}
          onRemove={annotate.remove}
          onReset={annotate.reset}
          onCancel={annotate.close}
          onSend={handleSendAnnotations}
        />
      )}
      <UserBrowserFrame
        tabs={tabs}
        activeTabId={activeTabId}
        loadingTabId={loadingTabId}
        viewportMode={viewportMode}
        zoomLevel={zoomLevel}
        onLoad={markLoaded}
        onFrame={setFrame}
        active={active}
        overlay={annotateActive ? (
          <AnnotateLayer
            shapes={annotate.shapes}
            tool={annotate.tool}
            selectedId={annotate.selectedId}
            onMeasure={handleMeasure}
            onAdd={handleAddShape}
            onSelect={annotate.select}
          />
        ) : null}
      />
    </div>
  );
}
