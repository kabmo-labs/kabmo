/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Terminal WebSocket: the only transport between a terminal panel and its PTY.
 *
 * Text frames are JSON control, binary frames are raw PTY bytes in both
 * directions. The client's first frame is `attach`, which also creates the
 * shell when the id is new — one round trip, and no separate create endpoint to
 * race against.
 *
 * The upgrade is origin-checked. Browsers happily open a WebSocket to
 * `localhost` from any page, and there is no preflight to stop them, so a
 * cross-origin page could otherwise drive a shell on this machine.
 *
 * Per-connection state lives on `ws.data`, not in a `WeakMap` keyed by the `ws`
 * object: Elysia hands a *different* wrapper to `message`/`close` than the one
 * `open` received (verified on 1.4.30), so a WeakMap lookup finds nothing and
 * every frame is silently dropped. `ws.data` is the same object throughout.
 */

import { Elysia, t } from 'elysia';
import { isSameOriginUpgrade } from '@/server/lib/http/same-origin';
import {
  attachTerminal,
  closeTerminal,
  detachTerminal,
  resizeTerminalDebounced,
  writeTerminalInput,
} from '@/server/lib/terminal/runtime.server';
import { TerminalRuntimeError, type TerminalViewer } from '@/server/lib/terminal/session.server';
import {
  decodeClientFrame,
  encodeServerFrame,
  isValidTerminalId,
} from '@/shared/lib/workspace/terminal/protocol';

interface Attachment {
  id: string;
  viewer: TerminalViewer;
  /** One attach per socket; a duplicate would replay the scrollback twice. */
  attached: boolean;
}

/** Elysia's ws context, narrowed to the per-connection store this route adds. */
type TerminalWsData = { params: { terminalId: string }; terminal?: Attachment };

export const terminalWsRoutes = new Elysia({ prefix: '/api/terminal' }).ws('/:terminalId/ws', {
  params: t.Object({ terminalId: t.String() }),

  beforeHandle({ request, status }) {
    if (!isSameOriginUpgrade(request)) return status(403, 'Cross-origin terminal upgrade rejected');
  },

  open(ws) {
    const data = ws.data as unknown as TerminalWsData;
    const id = data.params.terminalId;
    if (!isValidTerminalId(id)) {
      ws.close();
      return;
    }
    data.terminal = {
      id,
      attached: false,
      viewer: {
        send(frame) {
          try {
            // Bun returns -1 when the frame was dropped rather than queued
            // (the socket is over its high-water mark). Reporting it lets the
            // session close this viewer instead of buffering a PTY's output
            // into a socket nobody is reading.
            return ws.send(frame) !== -1;
          } catch {
            // Socket closed mid-send; the close handler detaches.
            return false;
          }
        },
        drop() {
          // The terminal session removed this viewer; close the socket so the
          // client reconnects and replays the scrollback rather than sitting
          // on a stream with a hole in it.
          try {
            ws.close();
          } catch {
            // Already gone.
          }
        },
      },
    };
  },

  async message(ws, raw) {
    const attachment = (ws.data as unknown as TerminalWsData).terminal;
    if (!attachment) return;

    // Raw PTY input (keystrokes, paste, mouse reports) — never JSON-escaped.
    if (raw instanceof Uint8Array) {
      writeTerminalInput(attachment.id, raw);
      return;
    }

    const frame = decodeClientFrame(raw);
    if (!frame) return;

    if (frame.t === 'resize') {
      resizeTerminalDebounced(attachment.id, frame.cols, frame.rows);
      return;
    }

    if (frame.t === 'close') {
      closeTerminal(attachment.id);
      return;
    }

    if (attachment.attached) return;

    try {
      const { snapshot, replay } = await attachTerminal(attachment.viewer, {
        id: attachment.id,
        cols: frame.cols,
        rows: frame.rows,
        root: frame.root,
        repo: frame.repo,
        theme: frame.theme,
      });
      attachment.attached = true;
      ws.send(encodeServerFrame({ t: 'ready', ...snapshot, replayBytes: replay.length }));
      // Ordering is safe without sequence numbers: attach captured the history
      // and registered this viewer in one synchronous block, so nothing can be
      // delivered between this frame and the replay that follows it.
      //
      // The replay goes through the viewer, so a socket that cannot take the
      // scrollback is closed rather than left attached to a terminal whose
      // first screenful was silently dropped.
      if (replay.length > 0 && !attachment.viewer.send(replay)) {
        detachTerminal(attachment.viewer, attachment.id);
        attachment.viewer.drop();
      }
    } catch (error) {
      const code = error instanceof TerminalRuntimeError ? error.code : 'unknown';
      const message = error instanceof Error ? error.message : String(error);
      ws.send(encodeServerFrame({ t: 'error', code, message }));
    }
  },

  close(ws) {
    const data = ws.data as unknown as TerminalWsData;
    const attachment = data.terminal;
    if (!attachment) return;
    data.terminal = undefined;
    detachTerminal(attachment.viewer, attachment.id);
  },
});
