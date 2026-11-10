import { useEffect, useRef, useState, useImperativeHandle, useCallback } from 'preact/hooks';
import { forwardRef } from 'preact/compat';
import { ArrowDown } from 'lucide-preact';
import { useTheme } from '@/client/hooks/ui/theme';
import { mountTerminal, type TerminalMount } from '@/client/components/workspace/terminal-panel/mount';

export interface RealtimeTerminalHandle {
  /** Raw PTY output. Bytes, not text: the WASM parser reassembles them. */
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
   * Feed text in as a paste. Goes through the terminal's own `paste`, which is
   * what wraps it in the bracketed-paste markers when the shell asked for
   * them — writing the bytes directly would make a multi-line paste execute
   * line by line in an editor that expects one block.
   */
  paste: (text: string) => void;
}

interface RealtimeTerminalViewProps {
  /** Keystrokes and paste, raw. */
  onInput: (data: string) => void;
  /** Non-UTF-8 payloads (legacy X10 mouse reports), as latin-1 bytes. */
  onBinaryInput: (bytes: Uint8Array) => void;
  /** The grid changed; the PTY must be resized to match. */
  onGridChange: (cols: number, rows: number) => void;
  /** The terminal is measurable and knows its size; attach with these. */
  onReady: (cols: number, rows: number) => void;
  /**
   * The theme changed and the terminal was rebuilt with the new palette; the
   * server's retained scrollback has to be requested again.
   */
  onReattach?: () => void;
}

/**
 * ghostty-web view bound to a real PTY.
 *
 * Every keystroke goes to the shell as bytes — line editing, history, tab
 * completion and Ctrl+C are the shell's job, not this component's. Output is
 * written as bytes so a character split across two PTY reads is reassembled by
 * the WASM parser rather than by a decode step here.
 */
export const RealtimeTerminalView = forwardRef<RealtimeTerminalHandle, RealtimeTerminalViewProps>(
  ({ onInput, onBinaryInput, onGridChange, onReady, onReattach }, ref) => {
    const { theme } = useTheme();
    const containerRef = useRef<HTMLDivElement>(null);
    const mountRef = useRef<TerminalMount | null>(null);
    const [isScrolledUp, setIsScrolledUp] = useState(false);

    const inputRef = useRef(onInput);
    inputRef.current = onInput;
    const binaryInputRef = useRef(onBinaryInput);
    binaryInputRef.current = onBinaryInput;
    const gridChangeRef = useRef(onGridChange);
    gridChangeRef.current = onGridChange;
    const readyRef = useRef(onReady);
    readyRef.current = onReady;
    const reattachRef = useRef(onReattach);
    reattachRef.current = onReattach;
    const themeRef = useRef(theme);
    themeRef.current = theme;

    /**
     * The WASM palette is fixed when the terminal is created, so a theme switch
     * is a terminal rebuild plus a scrollback replay, not a repaint. The effect
     * runs before the async mount resolves on first render (`mountRef` is null
     * then); that initial theme is the one `mountTerminal` was called with.
     */
    useEffect(() => {
      const mount = mountRef.current;
      if (!mount) return;
      mount.setTheme(theme);
      reattachRef.current?.();
    }, [theme]);

    useImperativeHandle(ref, () => ({
      write(bytes: Uint8Array) {
        mountRef.current?.write(bytes);
      },
      writeReplay(bytes: Uint8Array, cols: number, rows: number) {
        mountRef.current?.writeReplay(bytes, cols, rows);
      },
      reset() {
        mountRef.current?.reset();
      },
      focus() {
        mountRef.current?.focus();
      },
      applicationCursorKeys() {
        return mountRef.current?.applicationCursorKeys() ?? false;
      },
      getSelection() {
        return mountRef.current?.getSelection() ?? '';
      },
      paste(text: string) {
        mountRef.current?.paste(text);
      },
    }), []);

    const scrollToBottom = useCallback(() => {
      mountRef.current?.scrollToBottom();
      setIsScrolledUp(false);
    }, []);

    // Mount once. Sizing flows out through callbacks; the server owns the PTY,
    // so nothing here restarts a shell on its own.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      let cancelled = false;

      void mountTerminal(
        container,
        themeRef.current,
        {
          onInput: (data) => inputRef.current(data),
          onBinaryInput: (bytes) => binaryInputRef.current(bytes),
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
        // E2E types into the terminal's hidden input. The renderer creates it
        // inside `open`, so the hook cannot be written on the JSX element.
        container.querySelector('textarea')?.setAttribute('data-terminal-input', '');
      });

      return () => {
        cancelled = true;
        mountRef.current?.dispose();
        mountRef.current = null;
      };
    }, []);

    // No background and no padding: the terminal is not a surface of its own,
    // and the panel's paper shows through the strip the fit addon leaves for
    // its in-canvas scrollbar. `p-1.5` also made the grid narrower than the
    // panel, which read as a terminal that was not full width.
    return (
      <div className="relative flex-1 w-full h-full overflow-hidden">
        <div
          ref={containerRef}
          data-terminal-root=""
          className="kabmo-terminal w-full h-full cursor-text"
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

RealtimeTerminalView.displayName = 'RealtimeTerminalView';
