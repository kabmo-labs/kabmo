import { useState } from 'preact/hooks';
import { Minus, Square, X } from 'lucide-preact';

/**
 * The window's own controls, for a shell that has none.
 *
 * The macOS shell keeps the system's traffic lights (a `fullSizeContentView`
 * window over a transparent title bar), so the page draws nothing. The Windows
 * shell is borderless, and its webview is an HWND — no host element can be
 * painted over it — so the three buttons the system would draw have to come from
 * the page. `drawsWindowControls()` is what says which shell this is; the buttons
 * exist only there, and a browser tab never renders them.
 *
 * Two decisions:
 *
 * - **The glyphs are Lucide's, not the OS's.** Windows draws its own caption
 *   buttons at a size and weight that a web font cannot reproduce, so pretending
 *   to would look almost right — the worst outcome. These read as the app's
 *   chrome, which is what they are.
 * - **Close is the only one with a destructive hover.** A red fill on minimise
 *   would make a harmless action look dangerous.
 *
 * Every button is `aria-label`ed and titled: an icon-only control with no
 * accessible name is unreachable by keyboard and invisible to a screen reader.
 */
export function WindowControls() {
  const [maximised, setMaximised] = useState(false);
  const call = (method: 'window_minimize' | 'window_maximize' | 'window_close') => {
    void window.__kabmoCall?.(method).catch(() => undefined);
    // The shell owns the state; this only keeps the glyph honest between the
    // click and the window's own resize notification.
    if (method === 'window_maximize') setMaximised((value) => !value);
  };

  return (
    <div className="flex items-stretch h-10 -mr-1 titlebar-no-drag" role="group" aria-label="Window controls">
      <button
        type="button"
        onClick={() => call('window_minimize')}
        title="Minimize"
        aria-label="Minimize"
        className="w-11 inline-flex items-center justify-center text-ink/60 hover:bg-ink/10 hover:text-ink transition-colors cursor-pointer"
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        onClick={() => call('window_maximize')}
        title={maximised ? 'Restore' : 'Maximize'}
        aria-label={maximised ? 'Restore' : 'Maximize'}
        className="w-11 inline-flex items-center justify-center text-ink/60 hover:bg-ink/10 hover:text-ink transition-colors cursor-pointer"
      >
        <Square size={12} />
      </button>
      <button
        type="button"
        onClick={() => call('window_close')}
        title="Close (Alt+F4)"
        aria-label="Close"
        className="w-11 inline-flex items-center justify-center text-ink/60 hover:bg-error hover:text-paper transition-colors cursor-pointer"
      >
        <X size={15} />
      </button>
    </div>
  );
}
