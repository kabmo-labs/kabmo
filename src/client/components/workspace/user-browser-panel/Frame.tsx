import { useEffect, useRef } from 'preact/hooks';
import { Globe, Loader2 } from 'lucide-preact';
import { VIEWPORT_CLASSES } from '@/client/components/common/viewport';
import type { ComponentChildren } from 'preact';
import { tabUrl, type UserBrowserTab } from '@/shared/lib/browser/user-tabs';
import type { ViewportMode } from '@/shared/types';

interface UserBrowserFrameProps {
  tabs: UserBrowserTab[];
  activeTabId: string | null;
  /** Tab whose frame is still loading; only its indicator spins. */
  loadingTabId: string | null;
  viewportMode: ViewportMode;
  zoomLevel: number;
  onLoad: (tabId: string) => void;
  /** False while the panel is hidden: no iframe is mounted, so a background
   *  page cannot keep loading scripts or animating behind the panel. */
  active?: boolean;
  /** The annotation surface, rendered over the ACTIVE page only. */
  overlay?: ComponentChildren;
  /**
   * The live `<iframe>` of the active tab. A mark's element is read through this
   * handle, which is why it is reported rather than left to a query across the
   * DOM: only THIS frame holds the page the user is annotating.
   */
  onFrame?: (frame: HTMLIFrameElement | null) => void;
}

const ALLOW = 'clipboard-read; clipboard-write; fullscreen';

/**
 * The user's browsing surface: one iframe PER TAB, all mounted, only the active
 * one visible.
 *
 * Two things follow, and both are the reason it is not "one iframe, swap src":
 *
 * - A tab switch is INSTANT and lossless. An iframe's `src` is its document, so
 *   re-pointing one frame would reload a page the user already had: scroll
 *   position, typed form state and a login flow all restart. A browser keeps
 *   background tabs alive; so does this.
 * - A hidden tab is still one renderer, so the tab cap
 *   (`MAX_USER_BROWSER_TABS`) is the memory bound — not a UI preference.
 *
 * Interaction (scroll, click, typing, cookies, logins) is the browser's own, so
 * this costs nothing to keep mounted. Cross-origin pages cannot read this app,
 * and vice versa.
 *
 * The annotation overlay is a child of the wrapper that carries the zoom and
 * the viewport preset, so `inset: 0` covers the page exactly at every scale —
 * measured in Chromium at 150%: iframe 900×450, overlay 900×450.
 */
export function UserBrowserFrame({
  tabs,
  activeTabId,
  loadingTabId,
  viewportMode,
  zoomLevel,
  onLoad,
  active = true,
  overlay,
  onFrame,
}: UserBrowserFrameProps) {
  /** Every mounted tab's iframe, keyed by tab id. A single "the active frame"
   *  ref cannot work: on a switch Preact may set the incoming tab's ref before
   *  it clears the outgoing one, and the panel would then read `null` for the
   *  page it just activated. A map is order-independent. */
  const frames = useRef(new Map<string, HTMLIFrameElement>());

  // The signature covers a RELOAD too: a bumped `frameKey` remounts the active
  // iframe, so the panel's handle must be re-reported or annotating would read
  // the detached element the reload threw away.
  const signature = tabs.map((tab) => `${tab.id}:${tab.frameKey}`).join('|');

  useEffect(() => {
    onFrame?.(activeTabId ? frames.current.get(activeTabId) ?? null : null);
  }, [activeTabId, onFrame, signature]);

  if (!active) return null;
  const loaded = tabs.filter((tab) => tabUrl(tab) !== '');
  if (loaded.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none">
        <div className="w-12 h-12 rounded-xl bg-ink/5 border border-ink/10 flex items-center justify-center text-ink/40 mb-3">
          <Globe size={22} />
        </div>
        <h3 className="text-sm font-semibold text-ink mb-1">Browser Anda</h3>
        <p className="text-xs text-ink/60 max-w-sm">
          Type an address above and press Enter. The page loads inside this panel.
        </p>
        <p className="text-[11px] text-ink/45 max-w-sm mt-2">
          Sebagian situs (Google, GitHub) menolak ditampilkan dalam iframe — pakai tombol buka di tab baru.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 relative flex items-center justify-center p-2 overflow-auto bg-canvas/60">
      {loaded.map((tab) => {
        const url = tabUrl(tab);
        const activeTab = tab.id === activeTabId;
        const loading = tab.id === loadingTabId;
        return (
          <div
            key={tab.id}
            data-user-browser-tab={tab.id}
            // A hidden tab keeps its document mounted (display:none, never
            // unmounted) and takes no space; the active one is the only flex
            // child, exactly like the single-page layout this replaced.
            className={
              activeTab
                ? 'relative flex-1 min-h-0 flex items-center justify-center'
                : 'hidden'
            }
          >
            {loading ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                <div className="flex items-center space-x-2 px-3 py-1.5 rounded-md bg-paper border border-ink/15">
                  <Loader2 size={13} className="animate-spin text-ink/50" />
                  <span className="text-[11px] font-mono text-ink/60">Memuat…</span>
                </div>
              </div>
            ) : null}
            <div
              className={`relative flex flex-col bg-white ${VIEWPORT_CLASSES[viewportMode]} transition-all duration-200`}
              style={{
                zoom: zoomLevel !== 100 ? `${zoomLevel}%` : undefined,
                transformOrigin: 'top center',
              }}
            >
              <iframe
                // The key is the URL's own frame counter: a reload or a new
                // address remounts THIS tab's document, a switch changes nothing.
                key={`${tab.id}:${tab.frameKey}`}
                ref={(node: HTMLIFrameElement | null) => {
                  if (node) frames.current.set(tab.id, node);
                  else frames.current.delete(tab.id);
                }}
                src={url}
                title={`Browser pengguna ${tab.id}`}
                onLoad={() => onLoad(tab.id)}
                referrerPolicy="no-referrer"
                allow={ALLOW}
                className="w-full h-full bg-white border-0"
                // While annotating, the page must not receive a drag: the overlay
                // owns every pointer event, and a click reaching the page would
                // navigate the user away from the thing they were marking.
                style={activeTab && overlay ? { pointerEvents: 'none' } : undefined}
              />
              {activeTab ? overlay : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
