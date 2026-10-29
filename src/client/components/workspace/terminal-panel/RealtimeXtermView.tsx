import { useEffect, useRef, useState, useImperativeHandle, useCallback } from 'preact/hooks';
import { forwardRef } from 'preact/compat';
import { ArrowDown } from 'lucide-preact';
import { useTheme } from '@/client/hooks/ui/theme';
import { getXtermTheme } from '@/client/data/theme/terminal';
import { mountXterm, type XtermMount } from '@/client/components/workspace/terminal-panel/mount';

export interface RealtimeXtermHandle {
  /** Raw PTY output. Bytes, not text: xterm's decoder reassembles them. */
  write: (bytes: Uint8Array) => void;
  /**
   * Write the retained scrollback at the size it was drawn for, then fit back
   * to the panel. Replaying history at another width leaves wrapped fragments
   * the shell's own redraw never clears.
   */
  writeReplay: (bytes: Uint8Array, cols: number, rows: number) => void;
  /** Drop the buffer and reset the cursor — used when the shell is replaced. */
  reset: () => void;
  focus: () => void;
  /**
   * The shell's DECCKM state, read at the moment a key bar button is pressed.
   * A full-screen app (vim, less) sets it and then expects the SS3 spelling of
   * the arrows, so the encoding cannot be decided once at mount.
   */
  applicationCursorKeys: () => boolean;
  /** The current selection, empty when nothing is selected. */
  getSelection: () => string;
  /**
   * Feed text in as a paste. Goes through xterm's own `paste`, which is what
   * wraps it in the bracketed-paste markers when the shell asked for them —
   * writing the bytes directly would make a multi-line paste execute line by
   * line in an editor that expects one block.
   */
  paste: (text: string) => void;
}

interface RealtimeXtermViewProps {
  /** Keystrokes and paste, raw. */
  onInput: (data: string) => void;
  /** Non-UTF-8 payloads xterm reports separately (some mouse reports). */
  onBinaryInput: (data: string) => void;
  /** The grid changed; the PTY must be resized to match. */
  onGridChange: (cols: number, rows: number) => void;
  /** The terminal is measurable and knows its size; attach with these. */
  onReady: (cols: number, rows: number) => void;
  /** False while another panel is on screen: the WebGL context is released. */
  visible?: boolean;
}

/**
 * xterm view bound to a real PTY.
 *
 * Every keystroke goes to the shell as bytes — line editing, history, tab
 * completion and Ctrl+C are the shell's job, not this component's. Output is
 * written as bytes so a character split across two PTY reads is reassembled by
 * xterm's own streaming decoder rather than by a decode step here.
 */
export const RealtimeXtermView = forwardRef<RealtimeXtermHandle, RealtimeXtermViewProps>(
  ({ onInput, onBinaryInput, onGridChange, onReady, visible = true }, ref) => {
    const { theme } = useTheme();
    const containerRef = useRef<HTMLDivElement>(null);
    const mountRef = useRef<XtermMount | null>(null);
    const [isScrolledUp, setIsScrolledUp] = useState(false);

    const inputRef = useRef(onInput);
    inputRef.current = onInput;
    const binaryInputRef = useRef(onBinaryInput);
    binaryInputRef.current = onBinaryInput;
    const gridChangeRef = useRef(onGridChange);
    gridChangeRef.current = onGridChange;
    const readyRef = useRef(onReady);
    readyRef.current = onReady;
    const themeRef = useRef(theme);
    themeRef.current = theme;
    // Read when the async mount RESOLVES, not when this effect ran: `mountXterm`
    // imports xterm and the WebGL addon, so `mountRef.current` is still null on
    // the first pass and an effect that only ran then would leave the context
    // held by a panel that was never on screen.
    const visibleRef = useRef(visible);
    visibleRef.current = visible;

    useEffect(() => {
      const term = mountRef.current?.term;
      if (!term) return;
      term.options.theme = getXtermTheme(theme);
      term.refresh(0, term.rows - 1);
    }, [theme]);

    /**
     * Hold the WebGL context only while this view is on screen.
     *
     * The right-panel stack keeps every built-in view MOUNTED and hides the
     * inactive ones with CSS; the terminal is the one view that stays live while
     * hidden, because it owns a PTY. That made its GPU context permanent: eight
     * terminals held eight contexts, and `vmmap` on the desktop shell showed
     * `owned unmapped (graphics)` at 541.8 MB of an 817.7 MB footprint while the
     * JS heap was 12.6 MB. Releasing on hide drops the context — xterm's DOM
     * renderer keeps the buffer readable — and showing the panel re-creates it.
     */
    useEffect(() => {
      mountRef.current?.setWebgl(visible);
    }, [visible]);

    useImperativeHandle(ref, () => ({
      write(bytes: Uint8Array) {
        mountRef.current?.term.write(bytes);
      },
      writeReplay(bytes: Uint8Array, cols: number, rows: number) {
        mountRef.current?.writeReplay(bytes, cols, rows);
      },
      reset() {
        mountRef.current?.term.reset();
      },
      focus() {
        mountRef.current?.term.focus();
      },
      applicationCursorKeys() {
        return mountRef.current?.term.modes.applicationCursorKeysMode ?? false;
      },
      getSelection() {
        return mountRef.current?.term.getSelection() ?? '';
      },
      paste(text: string) {
        mountRef.current?.term.paste(text);
      },
    }), []);

    const scrollToBottom = useCallback(() => {
      mountRef.current?.term.scrollToBottom();
      setIsScrolledUp(false);
    }, []);

    // Mount once. Sizing flows out through callbacks; the server owns the PTY,
    // so nothing here restarts a shell on its own.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      let cancelled = false;

      void mountXterm(
        container,
        themeRef.current,
        {
          onInput: (data) => inputRef.current(data),
          onBinaryInput: (data) => binaryInputRef.current(data),
          onGridChange: (cols, rows) => gridChangeRef.current(cols, rows),
          onReady: (cols, rows) => readyRef.current(cols, rows),
          onScrolledUpChange: setIsScrolledUp,
        },
        () => cancelled,
      ).then((mount) => {
        if (!mount) return;
        if (cancelled) {
          mount.dispose();
          return;
        }
        mountRef.current = mount;
        // The panel can mount while another view is on screen — the stack keeps
        // every built-in mounted — so the context is released on arrival rather
        // than on the next visibility change.
        mount.setWebgl(visibleRef.current);
      });

      return () => {
        cancelled = true;
        mountRef.current?.dispose();
        mountRef.current = null;
      };
    }, []);

    return (
      <div className="relative flex-1 w-full h-full bg-canvas overflow-hidden">
        <div
          ref={containerRef}
          className="w-full h-full cursor-text p-1.5"
          style={{ height: '100%', width: '100%' }}
        />

        {isScrolledUp && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 right-4 z-20 flex items-center space-x-1.5 px-2.5 py-1 bg-paper hover:bg-canvas text-ink border border-ink/20 rounded-full shadow-lg text-[11px] font-mono transition-all animate-fade-in cursor-pointer active:scale-95"
            title="Scroll to latest output (Shift+End)"
          >
            <ArrowDown size={12} className="text-warning" />
            <span>Latest</span>
          </button>
        )}
      </div>
    );
  }
);

RealtimeXtermView.displayName = 'RealtimeXtermView';
