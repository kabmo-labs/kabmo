/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Live terminal session for the right panel: the socket, its status, and the
 * attach/resize/input verbs the xterm view drives.
 *
 * The terminal id is per chamber session and persisted, which is what makes the
 * shell survive a page reload: the panel reattaches to the id it already owns
 * and the server replays its scrollback. `restart` mints a new id, so a shell
 * that was exited (or wedged) is left behind rather than resurrected.
 *
 * The view owns the grid — it is the only thing that knows the container's
 * size — so attach and resize flow view → hook, while output flows hook → view
 * through the imperative handle the panel wires up.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { getSessionValue } from '@/shared/lib/workspace/session-state/store';
import { connectTerminal, type TerminalSocket } from '@/client/hooks/workspace/terminal/socket';
import { newTerminalId, type TerminalReadyFrame } from '@/shared/lib/workspace/terminal/protocol';

export type TerminalStatus = 'connecting' | 'running' | 'exited' | 'error';

export interface UseTerminalOptions {
  root?: string;
  repo?: string;
  theme?: 'light' | 'dark';
  onOutput?: (bytes: Uint8Array) => void;
  onReplay?: (bytes: Uint8Array, frame: TerminalReadyFrame) => void;
  /** Fired after the shell is replaced, so the view can drop its buffer. */
  onRestart?: () => void;
}

export interface UseTerminalResult {
  status: TerminalStatus;
  shell: string;
  /** Exit code of a finished shell, or null while it runs. */
  exitCode: number | null;
  /** Set when the socket reported an error frame. */
  error: string | null;
  attach: (cols: number, rows: number) => void;
  resize: (cols: number, rows: number) => void;
  input: (data: Uint8Array) => void;
  /** Replace the shell with a fresh one. */
  restart: () => void;
}

export function useTerminal(options: UseTerminalOptions = {}): UseTerminalResult {
  const { sessionId, ready } = useSessionStateContext();
  const [terminalId, setTerminalId] = useSessionState<string>('terminal.id', '');
  const [status, setStatus] = useState<TerminalStatus>('connecting');
  const [shell, setShell] = useState('');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<TerminalSocket | null>(null);
  // The grid the view reported, replayed on attach so a reconnect lands on the
  // size the panel actually has instead of the default.
  const sizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const outputRef = useRef(options.onOutput);
  outputRef.current = options.onOutput;
  const replayRef = useRef(options.onReplay);
  replayRef.current = options.onReplay;
  const restartRef = useRef(options.onRestart);
  restartRef.current = options.onRestart;
  const rootRef = useRef(options.root);
  rootRef.current = options.root;
  const repoRef = useRef(options.repo);
  repoRef.current = options.repo;
  const themeRef = useRef(options.theme);
  themeRef.current = options.theme;
  const setIdRef = useRef(setTerminalId);
  setIdRef.current = setTerminalId;
  /** Last `root\0repo` the shell was launched for; null until the first. */
  const scopeRef = useRef<string | null>(null);

  // One id per chamber session. The check reads the store, not the hook's local
  // value: on the render where the blob first becomes ready, `useSessionState`
  // still reports the fallback (its restore effect has not run yet), so
  // deciding from the local value would mint a second id and overwrite the
  // stored one — orphaning the live shell and its scrollback.
  useEffect(() => {
    if (!ready) return;
    if (getSessionValue<string>(sessionId, 'terminal.id')) return;
    setIdRef.current(newTerminalId());
  }, [ready, sessionId]);

  useEffect(() => {
    if (!ready || !terminalId) return;

    setStatus('connecting');
    setError(null);
    setExitCode(null);

    const socket = connectTerminal(terminalId, {
      onReady(frame) {
        setStatus('running');
        setShell(frame.shell);
        setExitCode(null);
      },
      onReplay(bytes, frame) {
        replayRef.current?.(bytes, frame);
      },
      onOutput(bytes) {
        outputRef.current?.(bytes);
      },
      onExit(code) {
        setStatus('exited');
        setExitCode(code);
      },
      onError(code, message) {
        setStatus('error');
        setError(`${code}: ${message}`);
      },
      onConnectionChange(connected) {
        if (!connected) setStatus('connecting');
      },
    });
    socketRef.current = socket;
    // The socket re-dials the same id after a drop; the panel's size is the one
    // to come back at. On a restart the view is already mounted and will not
    // report its grid again, so the remembered size is what makes the new shell
    // spawn at the right dimensions.
    const size = sizeRef.current;
    if (size) socket.attach(size.cols, size.rows, rootRef.current, repoRef.current, themeRef.current);

    return () => {
      socket.release();
      socketRef.current = null;
    };
  }, [ready, terminalId]);

  const restart = useCallback(() => {
    // Kill the old shell before minting a new id: leaving it to the idle
    // reaper would keep a dead terminal attached to this session for 30 min.
    socketRef.current?.close();
    restartRef.current?.();
    setIdRef.current(newTerminalId());
  }, []);

  /**
   * The repo picker in the header changes the shell's scope, and a PTY's cwd is
   * fixed at spawn — so a scope change replaces the shell instead of trying to
   * `cd` it (which would leave the user's own shell state — exports, jobs,
   * history — describing the old tree).
   *
   * The first scope seen is adopted without restarting: `root` arrives
   * asynchronously (the active project resolves with the sidebar data), and
   * restarting on that first transition would kill the shell the view is still
   * attaching.
   */
  useEffect(() => {
    if (!ready) return;
    const root = options.root;
    if (!root) return;
    const scope = `${root}\u0000${options.repo ?? '.'}`;
    if (scopeRef.current === null) {
      scopeRef.current = scope;
      return;
    }
    if (scopeRef.current === scope) return;
    scopeRef.current = scope;
    restart();
  }, [ready, options.root, options.repo, restart]);

  const attach = useCallback((cols: number, rows: number) => {
    sizeRef.current = { cols, rows };
    socketRef.current?.attach(cols, rows, rootRef.current, repoRef.current, themeRef.current);
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    sizeRef.current = { cols, rows };
    socketRef.current?.resize(cols, rows);
  }, []);

  const input = useCallback((data: Uint8Array) => {
    socketRef.current?.input(data);
  }, []);

  return { status, shell, exitCode, error, attach, resize, input, restart };
}
