/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Screen-cast manager for the project-shared omp Chromium.
 *
 * One viewer handle per SSE client: it picks a live page target — the caller's
 * pinned tab while it is still a live, owned tab, else the newest tab this
 * session's omp process owns — attaches a flattened CDP session, and streams
 * `Page.screencastFrame` JPEGs. It never attaches to a tab another session
 * owns, and the tab list it reports is scoped to those owned targets too,
 * because the shared daemon hosts every session's pages. A 1s poll re-reads the
 * registry so the view follows the agent's tab when a page is opened,
 * navigated, or replaced.
 *
 * The viewer NEVER closes the browser or kills Chromium — `close()` stops our
 * screencast and detaches our session; the shared WebSocket is only closed
 * when the last viewer detaches (see connection.ts).
 */

import type { BrowserTabInfo, BrowserViewFrame, BrowserViewState } from '@/shared/types';
import { shortUrl, type BrowserActionDraft } from '@/shared/lib/browser/activity';
import { CdpConnection } from '@/shared/lib/browser/cdp';
import { acquireConnection, releaseConnection } from '@/shared/lib/browser/connection';
import { OBSERVER_BINDING, installObserver, parseObserverPayload, type ObserverHandle } from '@/shared/lib/browser/observer';
import { ownedPages, parsePageTargets, pickTargetId, readTargetInfoPatch, type PageTarget } from '@/shared/lib/browser/targets';
import { readNumber, readString } from '@/shared/lib/browser/util';
import { isRecord } from '@/shared/lib/util/guards';
import { BROWSER_POLL_MS } from '@/shared/lib/workspace/refresh-cadence';

/**
 * What the stream asks the page for.
 *
 * `everyNthFrame: 1` (every frame) is what the panel used to request, and it is
 * the wrong default for a viewer that is watched, not sampled: a 30 fps page
 * produced 30 decodes a second, each one a full RGBA surface the renderer has to
 * allocate and free. Measured in WebKit with the canvas sink in place, 1 760
 * frames at 16 fps still cost ~8 KB of WebContent footprint per frame, so the
 * frame RATE is a real lever on top of the sink (`client/lib/browser/frame-canvas.ts`).
 * Every second frame keeps the motion readable at half the decodes, and the
 * size is the panel's own display width — 1 600 px was above every panel width
 * the app renders, so it was only ever downscaled.
 */
const SCREENCAST_PARAMS = {
  format: 'jpeg',
  quality: 60,
  maxWidth: 1280,
  maxHeight: 800,
  everyNthFrame: 2,
};

interface ScreencastOptions {
  /** Caller's preferred tab id; honored while it is still a live, owned page. */
  preferTargetId?: string;
  /** Re-read the session's agent-owned target ids from the runtime registry. */
  getOwnedTargetIds: () => Promise<string[]>;
  onFrame: (frame: BrowserViewFrame) => void;
  onState: (state: BrowserViewState) => void;
  onAction?: (action: BrowserActionDraft) => void;
}

export interface ScreencastHandle {
  close: () => void;
}

/** Attach to the project browser and start streaming a tab. */
export async function openScreencast(wsUrl: string, opts: ScreencastOptions): Promise<ScreencastHandle> {
  const conn = await acquireConnection(wsUrl);
  const session = new ScreencastSession(conn, opts);
  try {
    await session.start();
    if (session.closed) throw new Error('CDP connection closed before the screencast started');
  } catch (error) {
    session.close();
    releaseConnection(wsUrl, conn);
    throw error;
  }
  let released = false;
  return {
    close: () => {
      if (released) return;
      released = true;
      session.close();
      releaseConnection(wsUrl, conn);
    },
  };
}

class ScreencastSession {
  private readonly conn: CdpConnection;
  private readonly opts: ScreencastOptions;
  private targets: PageTarget[] = [];
  private ownedIds: string[] = [];
  private currentTargetId: string | null = null;
  private currentSessionId: string | null = null;
  private lastStateKey = '';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private observer: ObserverHandle | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private unsubscribeClose: (() => void) | null = null;
  private ticking = false;
  private _closed = false;

  constructor(conn: CdpConnection, opts: ScreencastOptions) {
    this.conn = conn;
    this.opts = opts;
  }

  get closed(): boolean {
    return this._closed;
  }

  async start(): Promise<void> {
    this.unsubscribeClose = this.conn.onClose(() => this.handleDisconnect());
    this.unsubscribeEvents = this.conn.onEvent((method, params, sessionId) => this.handleEvent(method, params, sessionId));
    // Lifecycle events are best-effort: the 1s poll covers discovery without them.
    await this.conn.send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
    await this.tick();
    if (this._closed) return;
    this.pollTimer = setInterval(() => {
      void this.tick();
    }, BROWSER_POLL_MS);
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.stopPolling();
    this.unsubscribeEvents?.();
    this.unsubscribeClose?.();
    this.unsubscribeEvents = null;
    this.unsubscribeClose = null;
    void this.detach();
  }

  private async tick(): Promise<void> {
    if (this._closed || this.ticking) return;
    this.ticking = true;
    try {
      const [ownedIds, targets] = await Promise.all([
        this.opts.getOwnedTargetIds().catch(() => [] as string[]),
        this.fetchTargets(),
      ]);
      if (this._closed) return;
      this.ownedIds = ownedIds;
      this.targets = targets;
      const nextTargetId = pickTargetId(targets, ownedIds, this.opts.preferTargetId);
      if (nextTargetId !== this.currentTargetId) await this.switchTarget(nextTargetId);
      this.emitCurrent();
    } catch {
      this.fail();
    } finally {
      this.ticking = false;
    }
  }

  private async fetchTargets(): Promise<PageTarget[]> {
    return parsePageTargets(await this.conn.send('Target.getTargets'));
  }

  private async switchTarget(nextTargetId: string | null): Promise<void> {
    await this.detach();
    if (!nextTargetId) return;
    const attached = await this.conn.send('Target.attachToTarget', { targetId: nextTargetId, flatten: true });
    const sessionId = isRecord(attached) ? readString(attached, 'sessionId') : undefined;
    if (!sessionId) throw new Error('CDP attachToTarget returned no session id');
    this.currentTargetId = nextTargetId;
    this.currentSessionId = sessionId;
    this.observer = await installObserver(this.conn, sessionId).catch(() => null);
    try {
      await this.conn.send('Page.startScreencast', SCREENCAST_PARAMS, sessionId);
    } catch (error) {
      await this.detach();
      throw error;
    }
  }

  private async detach(): Promise<void> {
    const sessionId = this.currentSessionId;
    this.observer?.dispose();
    this.observer = null;
    this.currentTargetId = null;
    this.currentSessionId = null;
    if (!sessionId) return;
    await this.conn.send('Page.stopScreencast', {}, sessionId).catch(() => {});
    // Target.detachFromTarget is browser-level: sessionId must stay in params,
    // not the routing field, or the attached session silently leaks.
    await this.conn.send('Target.detachFromTarget', { sessionId }).catch(() => {});
  }

  private handleEvent(method: string, params: unknown, sessionId?: string): void {
    if (this._closed) return;
    if (method === 'Page.screencastFrame') {
      this.handleFrame(params, sessionId);
      return;
    }
    if (method === 'Runtime.bindingCalled') {
      this.handleObserverEvent(params, sessionId);
      return;
    }
    if (method === 'Page.frameNavigated') {
      this.handleFrameNavigated(params, sessionId);
      return;
    }
    if (method === 'Target.targetInfoChanged') {
      const patch = readTargetInfoPatch(params);
      if (!patch) return;
      this.targets = this.targets.map((target) => (target.targetId === patch.targetId ? patch : target));
      if (patch.targetId === this.currentTargetId) this.emitCurrent();
      return;
    }
    if (method === 'Target.targetCreated' || method === 'Target.targetDestroyed') {
      void this.tick();
    }
  }

  private handleObserverEvent(params: unknown, sessionId?: string): void {
    if (!sessionId || sessionId !== this.currentSessionId || !isRecord(params)) return;
    if (readString(params, 'name') !== OBSERVER_BINDING) return;
    const action = parseObserverPayload(params.payload);
    if (action) this.emitAction(action);
  }

  private handleFrameNavigated(params: unknown, sessionId?: string): void {
    if (!sessionId || sessionId !== this.currentSessionId || !isRecord(params) || !isRecord(params.frame)) return;
    if (params.frame.parentId !== undefined) return;
    const url = readString(params.frame, 'url');
    if (!url || url === 'about:blank') return;
    this.emitAction({ kind: 'loaded', label: `Halaman dimuat: ${shortUrl(url)}` });
  }

  private emitAction(action: BrowserActionDraft): void {
    try {
      this.opts.onAction?.(action);
    } catch {
      // Subscriber bugs must not break the CDP reader.
    }
  }

  private handleFrame(params: unknown, sessionId?: string): void {
    if (!sessionId || sessionId !== this.currentSessionId || !isRecord(params)) return;
    const data = readString(params, 'data');
    if (!data) return;
    const frameSessionId = readNumber(params, 'sessionId');
    if (frameSessionId !== undefined) {
      // Always ack — dropping happens downstream, not here.
      void this.conn.send('Page.screencastFrameAck', { sessionId: frameSessionId }, sessionId).catch(() => {});
    }
    const frame: BrowserViewFrame = {
      data,
      mimeType: 'image/jpeg',
      targetId: this.currentTargetId ?? '',
    };
    try {
      this.opts.onFrame(frame);
    } catch {
      // Subscriber bugs (SSE encode failure) must not break frame acking.
    }
  }

  private emitCurrent(): void {
    if (this._closed) return;
    const current = this.targets.find((target) => target.targetId === this.currentTargetId);
    // Owned targets only: the shared daemon lists every session's pages, so
    // handing the raw target list to the panel would leak other sessions' tabs.
    const tabs: BrowserTabInfo[] = ownedPages(this.targets, this.ownedIds);
    if (current) {
      this.emit({ status: 'live', url: current.url, title: current.title, targetId: current.targetId, tabs });
    } else {
      this.emit({ status: 'no-tab', tabs });
    }
  }

  private emit(state: BrowserViewState, force = false): void {
    const key = JSON.stringify(state);
    if (!force && key === this.lastStateKey) return;
    this.lastStateKey = key;
    try {
      this.opts.onState(state);
    } catch {
      // Subscriber bugs must not break polling.
    }
  }

  private fail(): void {
    if (this.conn.closed) {
      this.handleDisconnect();
      return;
    }
    this.emitCurrent();
  }

  private handleDisconnect(): void {
    if (this._closed) return;
    this._closed = true;
    this.stopPolling();
    this.observer?.dispose();
    this.observer = null;
    this.unsubscribeEvents?.();
    this.unsubscribeClose?.();
    this.unsubscribeEvents = null;
    this.unsubscribeClose = null;
    this.currentTargetId = null;
    this.currentSessionId = null;
    this.emit({ status: 'browser-offline', tabs: [] }, true);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
