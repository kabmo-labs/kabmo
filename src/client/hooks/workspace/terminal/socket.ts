/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Client transport for one terminal: dial, attach, and stay attached.
 *
 * One socket carries both directions — JSON control frames out, raw PTY bytes
 * both ways. Three behaviours are deliberate:
 *
 * - **Binary in, binary out.** `binaryType = 'arraybuffer'` so output arrives as
 *   bytes and is handed straight to `term.write(Uint8Array)`; the client never
 *   decodes UTF-8 itself, which is what keeps a character split across two PTY
 *   reads intact.
 * - **`onBinary` carries the same bytes as `onData`.** xterm reports non-UTF-8
 *   payloads (some mouse reports, paste of raw bytes) on `onBinary`; forwarding
 *   only `onData` would silently drop them.
 * - **Reconnect, not re-create.** A dropped socket re-dials the same terminal
 *   id, so the shell and its scrollback survive a network blip or a page reload
 *   instead of a second shell appearing.
 */

import {
  decodeServerFrame,
  encodeClientFrame,
  terminalSocketUrl,
  type TerminalAttachFrame,
  type TerminalClientFrame,
  type TerminalReadyFrame,
  type TerminalServerFrame,
} from '@/shared/lib/workspace/terminal/protocol';
import { bodyBytes } from '@/shared/lib/util/bytes';

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;
/** Consecutive re-dials that never opened before the stream is given up on. */
const MAX_FAILED_DIALS = 4;

export interface TerminalSocketHandlers {
  /** The attach was accepted; `replayBytes` of scrollback follow. */
  onReady: (frame: TerminalReadyFrame) => void;
  /**
   * The retained scrollback, once. The view must render this at the reported
   * `replayCols`/`replayRows` before fitting its own viewport.
   */
  onReplay: (bytes: Uint8Array, frame: TerminalReadyFrame) => void;
  /** Live PTY output, after the replay. */
  onOutput: (bytes: Uint8Array) => void;
  onExit: (exitCode: number | null, signal: string | null) => void;
  onError: (code: string, message: string) => void;
  /** Connection state for the panel's status badge. */
  onConnectionChange: (connected: boolean) => void;
}

export interface TerminalSocket {
  /** Send one attach frame; ignored once a terminal is attached. */
  attach: (cols: number, rows: number, root?: string, repo?: string, theme?: 'light' | 'dark') => void;
  resize: (cols: number, rows: number) => void;
  /** Raw keystrokes or paste; never JSON-encoded. */
  input: (data: Uint8Array) => void;
  /** Kill the shell server-side. */
  close: () => void;
  /** Release the socket; the shell keeps running for the next attach. */
  release: () => void;
}

export function connectTerminal(terminalId: string, handlers: TerminalSocketHandlers): TerminalSocket {
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let established = false;
  let released = false;
  let attached = false;
  let lastAttach: TerminalAttachFrame | null = null;
  /** Scrollback accumulated so far, plus how many bytes are still expected. */
  let replayParts: Uint8Array[] = [];
  let replayRemaining = 0;
  let replayFrame: TerminalReadyFrame | null = null;

  const dial = () => {
    const ws = new WebSocket(terminalSocketUrl(terminalId));
    ws.binaryType = 'arraybuffer';
    socket = ws;

    ws.onopen = () => {
      if (released) return;
      failures = 0;
      established = true;
      handlers.onConnectionChange(true);
      // Re-attaching replays the retained scrollback, so a reconnected panel
      // converges on the shell's real state instead of showing a gap.
      if (lastAttach) ws.send(encodeClientFrame(lastAttach));
    };

    ws.onmessage = (event) => {
      if (released) return;
      if (event.data instanceof ArrayBuffer) {
        handleOutput(new Uint8Array(event.data));
        return;
      }
      const frame = decodeServerFrame(typeof event.data === 'string' ? event.data : '');
      if (frame) applyFrame(frame);
    };

    ws.onclose = () => {
      socket = null;
      if (released) return;
      handlers.onConnectionChange(false);
      attached = false;
      replayParts = [];
      replayRemaining = 0;
      replayFrame = null;
      if (!established) return;
      failures += 1;
      if (failures > MAX_FAILED_DIALS) return;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** (failures - 1), RECONNECT_MAX_MS);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!released) dial();
      }, delay);
    };

    ws.onerror = () => {
      // `onclose` follows and owns the retry decision.
    };
  };

  const applyFrame = (frame: TerminalServerFrame) => {
    if (frame.t === 'ready') {
      attached = true;
      replayFrame = frame;
      replayRemaining = frame.replayBytes;
      replayParts = [];
      handlers.onReady(frame);
      // An empty scrollback never produces a binary frame, so complete it here.
      if (replayRemaining === 0) finishReplay();
      return;
    }
    if (frame.t === 'exit') {
      handlers.onExit(frame.exitCode, frame.signal);
      return;
    }
    handlers.onError(frame.code, frame.message);
  };

  const handleOutput = (bytes: Uint8Array) => {
    if (replayRemaining <= 0) {
      handlers.onOutput(bytes);
      return;
    }
    // The server sends the scrollback as one frame, so this normally completes
    // in a single step; the accounting is what keeps a fragmented delivery
    // from being mistaken for live output.
    replayParts.push(bytes);
    replayRemaining -= bytes.length;
    if (replayRemaining > 0) return;
    finishReplay();
  };

  const finishReplay = () => {
    const frame = replayFrame;
    const parts = replayParts;
    replayFrame = null;
    replayParts = [];
    replayRemaining = 0;
    if (!frame) return;
    handlers.onReplay(parts.length === 1 ? parts[0] : concat(parts), frame);
  };

  dial();

  const send = (frame: TerminalClientFrame) => {
    const ws = socket;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(encodeClientFrame(frame));
  };

  return {
    attach(cols, rows, root, repo, theme) {
      if (attached) return;
      const frame: TerminalAttachFrame = { t: 'attach', cols, rows };
      if (root) frame.root = root;
      if (repo) frame.repo = repo;
      if (theme) frame.theme = theme;
      lastAttach = frame;
      send(frame);
    },
    resize(cols, rows) {
      send({ t: 'resize', cols, rows });
    },
    input(data) {
      const ws = socket;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      // `send` takes a `BufferSource`, which the platform refuses for a
      // shared-backed view; `bodyBytes` returns a plain-backed one as-is.
      ws.send(bodyBytes(data));
    },
    close() {
      send({ t: 'close' });
    },
    release() {
      released = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      const ws = socket;
      socket = null;
      if (!ws) return;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    },
  };
}

function concat(parts: Uint8Array[]): Uint8Array {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
