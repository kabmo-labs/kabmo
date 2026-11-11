import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useTerminal } from '@/client/hooks/workspace/terminal';
import { useRepoList, useRepoScope } from '@/client/hooks/workspace/repo-scope';
import { useTheme } from '@/client/hooks/ui/theme';
import { useTouchDevice } from '@/client/hooks/ui/touch-device';
import { useKeyboardInset } from '@/client/hooks/ui/keyboard-inset';
import { copyToClipboard, readClipboardText } from '@/client/hooks/ui/clipboard';
import { TerminalHeader } from '@/client/components/workspace/terminal-panel/Header';
import { TerminalQuickActions } from '@/client/components/workspace/terminal-panel/QuickActions';
import { TerminalKeyBar } from '@/client/components/workspace/terminal-panel/KeyBar';
import { RealtimeTerminalView, type RealtimeTerminalHandle } from '@/client/components/workspace/terminal-panel/RealtimeTerminalView';
import {
  NO_MODIFIERS,
  applyModifiers,
  resolveKeySequence,
  type TerminalKeyId,
  type TerminalModifier,
  type TerminalModifiers,
} from '@/shared/lib/workspace/terminal/keys';

interface TerminalPanelProps {
  className?: string;
  enabled?: boolean;
  rootPath?: string;
  showHeader?: boolean;
  /** True while this view is the one on screen (the layout's `active`). */
  active?: boolean;
}

const encoder = new TextEncoder();

export function TerminalPanel({ className = '', enabled = true, rootPath, showHeader = true, active = true }: TerminalPanelProps) {
  const terminalRef = useRef<RealtimeTerminalHandle>(null);
  const { isDark } = useTheme();
  // Only a device without a physical keyboard gets the key bar: on a desktop
  // every one of those keys is already under the user's fingers, and a strip of
  // them would cost the canvas height for nothing.
  const isTouchDevice = useTouchDevice();
  // The inset is measured from the panel's OWN bottom edge, so it can never
  // double-count a keyboard the container already shrank for.
  const rootRef = useRef<HTMLDivElement>(null);
  const keyboardInset = useKeyboardInset(rootRef);
  const [modifiers, setModifiers] = useState<TerminalModifiers>(NO_MODIFIERS);
  const { activeRepo, setActiveRepo } = useRepoScope(rootPath);
  const { repos, scanning: reposScanning, rescan: rescanRepos } = useRepoList(rootPath, enabled);
  const gridRef = useRef<{ cols: number; rows: number } | null>(null);
  // The latch is read inside `handleInput`, which the terminal calls outside React's
  // render — a ref is what makes it the value at the keystroke, not at mount.
  const modifiersRef = useRef(modifiers);
  modifiersRef.current = modifiers;

  const handleOutput = useCallback((bytes: Uint8Array) => {
    terminalRef.current?.write(bytes);
  }, []);

  /**
   * Opening the panel IS the intent to type, so focus follows the view becoming
   * visible: a terminal that needs a click before it accepts keystrokes is a
   * terminal that swallowed the first command. `active` is "selected AND the
   * column is open" (see `PanelBodyProps`), so a collapsed column or another
   * view on screen never points focus here, and the request survives the
   * renderer's async mount (`focus.ts`).
   */
  useEffect(() => {
    if (!active || !enabled) return;
    terminalRef.current?.focus();
  }, [active, enabled]);

  const handleReplay = useCallback((bytes: Uint8Array, frame: { replayCols: number; replayRows: number }) => {
    terminalRef.current?.writeReplay(bytes, frame.replayCols, frame.replayRows);
  }, []);

  const handleRestart = useCallback(() => {
    terminalRef.current?.reset();
  }, []);

  const {
    status,
    shell,
    exitCode,
    error,
    attach,
    resize,
    input,
    restart,
    reattach,
  } = useTerminal({
    // "Open" is this panel being selected with its column shown; the view is
    // mounted even when hidden, so mounting alone must never start a shell.
    visible: active && enabled,
    root: enabled ? rootPath : undefined,
    repo: activeRepo,
    theme: isDark ? 'dark' : 'light',
    onOutput: handleOutput,
    onReplay: handleReplay,
    onRestart: handleRestart,
  });

  // The view reports its grid before the first attach and on every fit, so the
  // PTY is created at the panel's real size instead of a default 80x24.
  const handleReady = useCallback((cols: number, rows: number) => {
    gridRef.current = { cols, rows };
    attach(cols, rows);
  }, [attach]);

  const handleGridChange = useCallback((cols: number, rows: number) => {
    const previous = gridRef.current;
    gridRef.current = { cols, rows };
    if (!previous) return;
    resize(cols, rows);
  }, [resize]);

  // Keystrokes arrive as text; `onBinary` payloads are latin-1 bytes and must
  // not be UTF-8 encoded on the way out.
  //
  // A latched modifier is folded in here, on the way out, because that is the
  // only place a soft keyboard's letters pass through — Ctrl+C on a phone is a
  // tap on `Ctrl` and then the `c` the OS keyboard produces.
  const handleInput = useCallback((data: string) => {
    const latched = modifiersRef.current;
    const armed = latched.ctrl || latched.alt;
    const encoded = applyModifiers(data, latched);
    // Only a single typed character consumes the latch. A paste, a mouse report
    // or a focus event arrives on this same event and must leave the armed
    // modifier alone, or the tap that armed it is silently spent on a no-op.
    if (armed && data.length === 1) setModifiers(NO_MODIFIERS);
    input(encoder.encode(encoded));
  }, [input]);

  const handleToggleModifier = useCallback((modifier: TerminalModifier) => {
    setModifiers((previous) => ({ ...previous, [modifier]: !previous[modifier] }));
    terminalRef.current?.focus();
  }, []);

  const handleKey = useCallback((id: TerminalKeyId) => {
    const sequence = resolveKeySequence(id, {
      applicationCursorKeys: terminalRef.current?.applicationCursorKeys() ?? false,
      modifiers: modifiersRef.current,
    });
    if (!sequence) return;
    input(encoder.encode(sequence));
    setModifiers(NO_MODIFIERS);
    // Keep the OS keyboard where it was; a key bar tap must not dismiss it.
    terminalRef.current?.focus();
  }, [input]);

  /**
   * Cmd+C / Cmd+V, the two chords a terminal actually has — a phone can neither
   * select on the canvas nor reach its own clipboard from there. Copy reports
   * whether it had anything to copy so the bar can say "nothing selected"
   * instead of flashing success over an untouched clipboard.
   */
  const handleCopy = useCallback(async () => {
    const selection = terminalRef.current?.getSelection() ?? '';
    if (!selection) return false;
    return copyToClipboard(selection);
  }, []);

  const handlePaste = useCallback(async () => {
    const text = await readClipboardText();
    if (text === null || text.length === 0) return false;
    // Through the terminal's own paste, so a bracketed-paste shell gets its markers.
    terminalRef.current?.paste(text);
    terminalRef.current?.focus();
    return true;
  }, []);

  const handleBinaryInput = useCallback((bytes: Uint8Array) => {
    input(bytes);
  }, [input]);

  const handleQuickAction = useCallback((command: string) => {
    input(encoder.encode(`${command}\r`));
    terminalRef.current?.focus();
  }, [input]);

  const handleRestartClick = useCallback(() => {
    restart();
  }, [restart]);

  const handleReattach = useCallback(() => {
    reattach();
  }, [reattach]);

  if (!enabled) {
    return (
      <div className={`flex flex-col h-full bg-paper items-center justify-center text-ink/40 ${className}`}>
        <span className="text-xs font-mono text-muted">No session selected</span>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`flex flex-col h-full w-full bg-paper text-ink overflow-hidden ${className}`}
      aria-hidden={!active}
      // The soft keyboard covers the bottom of the visual viewport without
      // shrinking the layout one, so the key bar would sit behind the keys the
      // user is typing on. Lifting by the panel's actual overlap with the
      // visible area keeps the bar — and the shell's own grid, which the fit
      // observer re-measures — above the keyboard, and lifts nothing at all
      // when the container already ends above it.
      style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
    >
      {showHeader && (
        <TerminalHeader
          status={status}
          exitCode={exitCode}
          rootPath={rootPath}
          activeRepo={activeRepo}
          onSelectRepo={setActiveRepo}
          repos={repos}
          reposScanning={reposScanning}
          onRefreshRepos={rescanRepos}
          shell={shell}
          onRestart={handleRestartClick}
        />
      )}

      {/* Preset command shortcuts: typed into the live shell, not a new process */}
      <TerminalQuickActions onSelectCommand={handleQuickAction} disabled={status !== 'running'} />

      {error && (
        <div className="px-3 py-1.5 border-b border-error/20 bg-error/5 text-[11px] font-mono text-error flex-shrink-0">
          {error}
        </div>
      )}

      {/* Real-time terminal canvas, driven by the PTY socket */}
      <div className="flex-1 w-full min-h-0 bg-canvas overflow-hidden">
        <RealtimeTerminalView
          ref={terminalRef}
          onInput={handleInput}
          onBinaryInput={handleBinaryInput}
          onReady={handleReady}
          onGridChange={handleGridChange}
          onReattach={handleReattach}
        />
      </div>

      {isTouchDevice && (
        <TerminalKeyBar
          modifiers={modifiers}
          onToggleModifier={handleToggleModifier}
          onKey={handleKey}
          onCopy={handleCopy}
          onPaste={handlePaste}
          disabled={status !== 'running'}
        />
      )}
    </div>
  );
}
