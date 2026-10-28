/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Wire contract for the terminal socket — the only transport a terminal panel
 * uses.
 *
 * Two frame kinds share one duplex socket:
 *
 * - **text** frames are JSON control (`attach`, `resize`, `close` upstream;
 *   `ready`, `exit`, `error` downstream). Elysia hands inbound JSON to the
 *   handler already parsed and inbound binary as a `Uint8Array`, so the split
 *   is unambiguous on both ends.
 * - **binary** frames are raw PTY bytes in both directions. Keystrokes are
 *   never JSON-escaped, so `\x03`, `\x1b[A` and paste payloads reach the shell
 *   byte-for-byte, and output is written straight into xterm without a decode
 *   step in between.
 *
 * The first binary frame after `ready` is the retained scrollback (it may be
 * empty); everything after it is live output.
 */

import { isRecord } from '@/shared/lib/util/guards';

/** Grid bounds both ends clamp to, so a bogus size can never reach the PTY. */
export const TERMINAL_MIN_COLS = 2;
export const TERMINAL_MAX_COLS = 1000;
export const TERMINAL_MIN_ROWS = 1;
export const TERMINAL_MAX_ROWS = 500;

/** Largest single input frame accepted from a client (keystrokes or paste). */
export const TERMINAL_MAX_INPUT_BYTES = 64 * 1024;

/** Ids key a server-side map and appear in a path segment. */
const TERMINAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type TerminalStatus = 'running' | 'exited';

export interface TerminalSnapshot {
  id: string;
  /** Working directory the shell was launched in. */
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  status: TerminalStatus;
  exitCode: number | null;
  signal: string | null;
  bunVersion: string;
  nodeVersion: string;
  /**
   * True when a command holds the terminal's foreground. An idle shell sitting
   * at its prompt is running but not busy, which is the distinction the cap and
   * the status badge both use.
   */
  busy?: boolean;
  /**
   * Size the retained scrollback was drawn for. The client replays at this
   * size and only then fits its own viewport: re-wrapping history drawn for
   * another width leaves fragments the shell's own redraw never clears.
   */
  replayCols: number;
  replayRows: number;
}

export interface TerminalAttachFrame {
  t: 'attach';
  cols: number;
  rows: number;
  root?: string;
  repo?: string;
  theme?: 'light' | 'dark';
}

export interface TerminalResizeFrame {
  t: 'resize';
  cols: number;
  rows: number;
}

export interface TerminalCloseFrame {
  t: 'close';
}

export type TerminalClientFrame = TerminalAttachFrame | TerminalResizeFrame | TerminalCloseFrame;

export interface TerminalReadyFrame extends TerminalSnapshot {
  t: 'ready';
  /**
   * Length of the replay frame that follows. Zero means the scrollback is
   * empty; either way the client counts these bytes before it treats anything
   * as live output, so it can replay at `replayCols`/`replayRows` first.
   */
  replayBytes: number;
}

export interface TerminalExitFrame {
  t: 'exit';
  exitCode: number | null;
  signal: string | null;
}

export type TerminalErrorCode = 'capacity' | 'cwd' | 'shell' | 'spawn' | 'unknown';

export interface TerminalErrorFrame {
  t: 'error';
  code: TerminalErrorCode;
  message: string;
}

export type TerminalServerFrame = TerminalReadyFrame | TerminalExitFrame | TerminalErrorFrame;

/**
 * Terminal ids are client-generated. `randomUUID` needs a secure context, and
 * Kabmo is reachable over plain http on a LAN address (`--lan`), so the
 * fallback is what keeps that deployment working.
 */
export function newTerminalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isValidTerminalId(value: string): boolean {
  return TERMINAL_ID_PATTERN.test(value);
}

/** Clamp a proposed grid to the bounds the PTY runtime accepts. */
export function clampTerminalSize(cols: number, rows: number): { cols: number; rows: number } {
  return {
    cols: clampDimension(cols, TERMINAL_MIN_COLS, TERMINAL_MAX_COLS),
    rows: clampDimension(rows, TERMINAL_MIN_ROWS, TERMINAL_MAX_ROWS),
  };
}

export function encodeServerFrame(frame: TerminalServerFrame): string {
  return JSON.stringify(frame);
}

export function encodeClientFrame(frame: TerminalClientFrame): string {
  return JSON.stringify(frame);
}

/** Decode a control frame from either a parsed object or raw JSON text. */
export function decodeClientFrame(raw: unknown): TerminalClientFrame | null {
  const value = typeof raw === 'string' ? tryParse(raw) : raw;
  if (!isRecord(value)) return null;

  if (value.t === 'attach') {
    const cols = readDimension(value.cols);
    const rows = readDimension(value.rows);
    if (cols === null || rows === null) return null;
    const frame: TerminalAttachFrame = { t: 'attach', cols, rows };
    if (typeof value.root === 'string') frame.root = value.root;
    if (typeof value.repo === 'string') frame.repo = value.repo;
    if (value.theme === 'light' || value.theme === 'dark') frame.theme = value.theme;
    return frame;
  }

  if (value.t === 'resize') {
    const cols = readDimension(value.cols);
    const rows = readDimension(value.rows);
    if (cols === null || rows === null) return null;
    return { t: 'resize', cols, rows };
  }

  if (value.t === 'close') return { t: 'close' };
  return null;
}

export function decodeServerFrame(raw: string): TerminalServerFrame | null {
  const value = tryParse(raw);
  if (!isRecord(value)) return null;

  if (value.t === 'ready') {
    if (typeof value.id !== 'string' || typeof value.cwd !== 'string') return null;
    const replayBytes = typeof value.replayBytes === 'number' ? value.replayBytes : 0;
    return { ...(value as unknown as TerminalSnapshot), t: 'ready', replayBytes };
  }

  if (value.t === 'exit') {
    return {
      t: 'exit',
      exitCode: typeof value.exitCode === 'number' ? value.exitCode : null,
      signal: typeof value.signal === 'string' ? value.signal : null,
    };
  }

  if (value.t === 'error' && typeof value.message === 'string') {
    return { t: 'error', code: readErrorCode(value.code), message: value.message };
  }

  return null;
}

/** WebSocket endpoint for one terminal. Browser-only: reads `window.location`. */
export function terminalSocketUrl(terminalId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/terminal/${encodeURIComponent(terminalId)}/ws`;
}

function clampDimension(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function readDimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function readErrorCode(value: unknown): TerminalErrorCode {
  return value === 'capacity' || value === 'cwd' || value === 'shell' || value === 'spawn' ? value : 'unknown';
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
