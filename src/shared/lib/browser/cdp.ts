/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Minimal dependency-free Chrome DevTools Protocol client over the process-wide
 * `WebSocket` global (Node >= 22). It implements only what the browser viewer
 * needs: numeric JSON-RPC request/response correlation, flattened session
 * routing (`sessionId` on commands and events), and event fan-out. No
 * Playwright/Puppeteer — CDP is a stable wire protocol.
 */

import { readString } from '@/shared/lib/browser/util';
import { isRecord } from '@/shared/lib/util/guards';

const DEFAULT_TIMEOUT_MS = 15_000;

type CdpEventHandler = (method: string, params: unknown, sessionId?: string) => void;

interface PendingCommand {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CdpConnection {
  private readonly ws: WebSocket;
  private readonly timeoutMs: number;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly eventHandlers = new Set<CdpEventHandler>();
  private readonly closeHandlers = new Set<() => void>();
  private nextId = 1;
  private _closed = false;

  private constructor(ws: WebSocket, timeoutMs: number) {
    this.ws = ws;
    this.timeoutMs = timeoutMs;
    ws.addEventListener('message', (event) => this.handleMessage(event.data));
    ws.addEventListener('close', () => this.handleClose());
    ws.addEventListener('error', () => this.handleClose());
  }

  /** Open a CDP WebSocket; resolves once connected or rejects on timeout/error. */
  static connect(wsUrl: string, opts: { timeoutMs?: number } = {}): Promise<CdpConnection> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(wsUrl);
      const connection = new CdpConnection(ws, timeoutMs);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        safeClose(ws);
        reject(new Error(`CDP connect timed out after ${timeoutMs}ms: ${wsUrl}`));
      }, timeoutMs);
      timer.unref?.();
      ws.addEventListener(
        'open',
        () => {
          if (settled) {
            safeClose(ws);
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(connection);
        },
        { once: true },
      );
      ws.addEventListener(
        'error',
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error(`CDP connect failed: ${wsUrl}`));
        },
        { once: true },
      );
    });
  }

  get closed(): boolean {
    return this._closed;
  }

  /** Send a CDP command; rejects on protocol error, socket close, or timeout. */
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    if (this._closed) return Promise.reject(new Error('CDP connection is closed'));
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const entry: PendingCommand = {
        method,
        resolve,
        reject,
        timer: setTimeout(() => {
          if (this.pending.get(id) !== entry) return;
          this.pending.delete(id);
          reject(new Error(`CDP command timed out after ${this.timeoutMs}ms: ${method}`));
        }, this.timeoutMs),
      };
      entry.timer.unref?.();
      this.pending.set(id, entry);
      const frame: Record<string, unknown> = { id, method, params };
      if (sessionId) frame.sessionId = sessionId;
      try {
        this.ws.send(JSON.stringify(frame));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(entry.timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  onEvent(handler: CdpEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  /** Run `handler` once when the socket closes (already-closed → immediate no-op). */
  onClose(handler: () => void): () => void {
    if (this._closed) return () => {};
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }

  close(): void {
    if (this._closed) return;
    this.handleClose();
    safeClose(this.ws);
  }

  private handleMessage(data: unknown): void {
    if (this._closed || typeof data !== 'string') return;
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    if (typeof message.id === 'number') {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (isRecord(message.error)) {
        const text = readString(message.error, 'message') ?? 'CDP error';
        entry.reject(new Error(`${entry.method}: ${text}`));
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    if (typeof message.method !== 'string') return;
    const params = message.params;
    const sessionId = typeof message.sessionId === 'string' ? message.sessionId : undefined;
    for (const handler of this.eventHandlers) {
      try {
        handler(message.method, params, sessionId);
      } catch {
        // A subscriber bug must never kill the protocol reader.
      }
    }
  }

  private handleClose(): void {
    if (this._closed) return;
    this._closed = true;
    const error = new Error('CDP connection closed');
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    this.eventHandlers.clear();
    for (const handler of this.closeHandlers) {
      try {
        handler();
      } catch {
        // Close subscribers are independent; one throwing must not skip the rest.
      }
    }
    this.closeHandlers.clear();
  }
}

function safeClose(ws: WebSocket): void {
  try {
    ws.close();
  } catch {
    // Socket already closing/closed.
  }
}
