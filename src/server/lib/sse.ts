/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared Server-Sent Events plumbing for Kabmo's streaming routes.
 *
 * Six SSE endpoints hand-rolled the same lifecycle — a `TextEncoder`, a
 * `ReadableStream`, `event:`/`data:` frame encoding, an optional comment-frame
 * heartbeat, abort teardown, and a `text/event-stream` Response. The agent SSE
 * and WebSocket transports additionally hand-rolled the same latest-wins
 * backpressure policy. This module owns both pieces:
 *
 * - `createSseStream` — the HTTP lifecycle and wire format.
 * - `createEventCoalescer` — the coalescing policy, transport-agnostic so the
 *   WebSocket twin can reuse it over `ws.send` instead of `controller.enqueue`.
 *
 * Wire format is fixed: `event: <name>\ndata: <json>\n\n`, or `data: <json>\n\n`
 * when no event name is supplied (the agent/omp-login data-only frames).
 */

/** Emit one SSE frame. An empty `event` writes a data-only frame. */
export type SseSend = (event: string, data: unknown) => void;

export interface SseHandlers {
  send: SseSend;
  /** Idempotent teardown: timers, abort listener, caller cleanup, close. */
  close: () => void;
  /** True while the consumer is behind (`desiredSize < 0`). */
  isBackpressured: () => boolean;
  /** True once the stream has been torn down. */
  isClosed: () => boolean;
}

export interface SseStream {
  /** `text/event-stream` Response ready to return from a loader/action. */
  response: Response;
  /** Emit one frame. An empty `event` writes a data-only frame. */
  send: SseSend;
  /** Idempotent teardown: timers, abort listener, caller cleanup, close. */
  close: () => void;
  /** True while the consumer is behind (`desiredSize < 0`). */
  isBackpressured: () => boolean;
  /** True once the stream has been torn down. */
  isClosed: () => boolean;
}

export interface SseStreamOptions {
  /**
   * Runs inside `ReadableStream.start` after the abort listener is armed. May
   * be async; may return a cleanup callback (run on teardown, before close).
   */
  onStart?: (handlers: SseHandlers) => void | (() => void) | Promise<void | (() => void)>;
  /** Comment-frame heartbeat interval (`:\n\n`). Omit for no heartbeat. */
  heartbeatMs?: number;
  /** Runs before each heartbeat; return false to skip that beat. */
  beforeHeartbeat?: () => boolean;
  /** Abort signal that tears the stream down (client disconnect). */
  signal?: AbortSignal;
  /** Extra/overriding headers merged over the defaults. */
  headers?: Record<string, string>;
}

export function createSseStream(options: SseStreamOptions = {}): SseStream {
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let cleaned = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let onStartCleanup: (() => void) | null = null;

  function cleanup(): void {
    if (cleaned) return;
    cleaned = true;
    closed = true;
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    options.signal?.removeEventListener('abort', onAbort);
    const fn = onStartCleanup;
    onStartCleanup = null;
    if (fn) {
      try {
        fn();
      } catch {
        // Caller cleanup is best-effort.
      }
    }
    try {
      streamController?.close();
    } catch {
      // Controller already closed.
    }
  }

  const onAbort = (): void => cleanup();

  const send: SseSend = (event, data) => {
    if (closed || !streamController) return;
    const frame = event
      ? `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
      : `data: ${JSON.stringify(data)}\n\n`;
    try {
      streamController.enqueue(encoder.encode(frame));
    } catch {
      cleanup();
    }
  };

  const isBackpressured = (): boolean => {
    const controller = streamController;
    return controller !== null && controller.desiredSize !== null && controller.desiredSize < 0;
  };

  const handlers: SseHandlers = { send, close: cleanup, isBackpressured, isClosed: () => closed };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      streamController = controller;

      if (options.heartbeatMs !== undefined) {
        heartbeatTimer = setInterval(() => {
          if (closed) return;
          if (options.beforeHeartbeat && !options.beforeHeartbeat()) return;
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(':\n\n'));
          } catch {
            cleanup();
          }
        }, options.heartbeatMs);
      }

      if (options.signal) {
        options.signal.addEventListener('abort', onAbort);
        if (options.signal.aborted) {
          cleanup();
          return;
        }
      }

      const result = await options.onStart?.(handlers);
      onStartCleanup = typeof result === 'function' ? result : null;
      if (cleaned) {
        const fn = onStartCleanup;
        onStartCleanup = null;
        try {
          fn?.();
        } catch {
          // Caller cleanup is best-effort.
        }
      }
    },
    cancel() {
      cleanup();
    },
  });

  const response = new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...options.headers,
    },
  });

  return { response, send, close: cleanup, isBackpressured, isClosed: () => closed };
}

export interface EventCoalescer {
  /** Coalesce replaceable frames while backpressured, else send immediately. */
  push: (event: string, data: unknown) => void;
  /** Force the pending frame out now. False when the sink is already torn down. */
  flush: () => boolean;
  /** Drop the pending frame and cancel the delayed flush. */
  dispose: () => void;
}

export interface EventCoalescerOptions {
  send: SseSend;
  /** Backpressure probe — `desiredSize < 0` for SSE, buffered bytes for WS. */
  isBackpressured: () => boolean;
  /** Longest a coalesced frame waits before it is flushed anyway. */
  flushDelayMs: number;
}

/**
 * Latest-wins coalescer for replaceable `message_update` frames. Control frames
 * are never dropped; they flush the pending update first so ordering is kept.
 */
export function createEventCoalescer(options: EventCoalescerOptions): EventCoalescer {
  let pending: unknown = null;
  let pendingEvent = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const flush = (): boolean => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const data = pending;
    const event = pendingEvent;
    pending = null;
    pendingEvent = '';
    if (data === null) return true;
    if (disposed) return false;
    options.send(event, data);
    return !disposed;
  };

  const scheduleFlush = (): void => {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (!disposed) flush();
    }, options.flushDelayMs);
  };

  return {
    push(event, data) {
      if (disposed) return;
      const type = (data as { type?: string } | null)?.type;
      if (type === 'message_update' && options.isBackpressured()) {
        pending = data;
        pendingEvent = event;
        scheduleFlush();
        return;
      }
      if (!flush()) return;
      options.send(event, data);
    },
    flush,
    dispose() {
      if (disposed) return;
      disposed = true;
      pending = null;
      pendingEvent = '';
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    },
  };
}
