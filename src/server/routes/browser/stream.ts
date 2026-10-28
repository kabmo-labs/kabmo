/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * GET /api/browser/:sessionId/stream — SSE stream of the browser tab that the
 * session's own omp process drives inside the project-shared Chromium.
 *
 * Events:
 * - `state` → BrowserViewState JSON (status: agent-offline | browser-offline |
 *   no-tab | live, plus url/title/targetId/tabs when known)
 * - `frame` → BrowserViewFrame JSON (base64 JPEG + dimensions + targetId)
 *
 * While the agent, the shared browser, or an agent-owned tab is missing, the
 * route emits a coarse state and keeps polling every 1s instead of erroring —
 * any of those can appear later in the session's life. The stream stays scoped
 * to this session's own tabs: the daemon is project-shared, so neither the
 * framebuffer nor the tab list ever falls back to another session's page.
 * Frames are dropped under
 * consumer backpressure (desiredSize < 0); the screencast itself is already
 * acked upstream, so dropping is lossless latest-wins.
 */

import type { LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { isMockMode } from '@/server/mock.server';
import { extractEvalActions } from '@/shared/lib/browser/activity';

import { isRecord } from '@/shared/lib/util/guards';
import { getRpcSession } from '@/server/lib/omp/rpc/session-registry';
import { findProjectRuntimeDir, readOwnedTargetIds } from '@/server/lib/browser/runtime';
import { openScreencast, type ScreencastHandle } from '@/shared/lib/browser/viewer';
import { type TargetWatcherHandle, watchOwnedTargets } from '@/shared/lib/browser/watcher';
import type { BrowserPanelAction, BrowserViewFrame, BrowserViewState } from '@/shared/types';
import { createSseStream } from '@/server/lib/sse';
import { BROWSER_POLL_MS, STREAM_HEARTBEAT_MS } from '@/shared/lib/workspace/refresh-cadence';

const BROWSER_OFFLINE: BrowserViewState = { status: 'browser-offline', tabs: [] };

export async function loader({ params, request }: LoaderFunctionArgs) {
  const sessionId = params.sessionId ?? '';
  const preferTargetId = new URL(request.url).searchParams.get('target') ?? undefined;

  let closed = false;

  const stream = createSseStream({
    heartbeatMs: STREAM_HEARTBEAT_MS,
    signal: request.signal,
    headers: { 'Cache-Control': 'no-cache, no-transform' },
    onStart(handlers) {
      let lastStateKey = '';
      let viewer: ScreencastHandle | null = null;
      let viewerWsUrl: string | null = null;
      let watcher: TargetWatcherHandle | null = null;
      let watcherWsUrl: string | null = null;
      let tickInFlight = false;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let actionSeq = 0;
      let agentSource: unknown = null;
      let unsubscribeAgent: (() => void) | null = null;

      const detachViewer = (): void => {
        const current = viewer;
        viewer = null;
        viewerWsUrl = null;
        if (!current) return;
        try {
          current.close();
        } catch {
          // Already closed by a disconnect callback.
        }
      };

      const dropWatcher = (): void => {
        const current = watcher;
        watcher = null;
        watcherWsUrl = null;
        current?.close();
      };

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        detachViewer();
        dropWatcher();
        unsubscribeAgent?.();
        unsubscribeAgent = null;
        agentSource = null;
        if (pollTimer !== null) clearInterval(pollTimer);
        pollTimer = null;
        handlers.close();
      };

      const emitState = (state: BrowserViewState): void => {
        const key = JSON.stringify(state);
        if (key === lastStateKey) return;
        lastStateKey = key;
        handlers.send('state', state);
      };

      const emitAction = (action: { kind: BrowserPanelAction['kind']; label: string }): void => {
        actionSeq += 1;
        const payload: BrowserPanelAction = { id: `act-${actionSeq}`, kind: action.kind, label: action.label };
        handlers.send('action', payload);
      };

      const emitFrame = (frame: BrowserViewFrame): void => {
        // Backpressure: keep at most a couple of pending frames; drop the rest.
        if (handlers.isBackpressured()) return;
        handlers.send('frame', frame);
      };

      const tick = async (): Promise<void> => {
        if (closed || tickInFlight) return;
        tickInFlight = true;
        try {
          if (isMockMode()) {
            detachViewer();
            emitState(BROWSER_OFFLINE);
            return;
          }
          const session = getRpcSession(sessionId);
          if (!session || !session.isAlive()) {
            dropWatcher();
            unsubscribeAgent?.();
            unsubscribeAgent = null;
            agentSource = null;
            detachViewer();
            emitState({ status: 'agent-offline', tabs: [] });
            return;
          }
          if (agentSource !== session) {
            unsubscribeAgent?.();
            agentSource = session;
            unsubscribeAgent = session.onEvent((event) => {
              if (typeof event.toolName !== 'string' || event.toolName !== 'eval') return;
              if (event.type === 'tool_execution_start') {
                const args = isRecord(event.args) ? event.args : {};
                for (const action of extractEvalActions({ code: args.code, title: args.title })) {
                  emitAction(action);
                }
                void tick();
              } else if (event.type === 'tool_execution_update') {
                void tick();
              } else if (event.type === 'tool_execution_end' && event.isError === true) {
                emitAction({ kind: 'error', label: 'Aksi browser gagal' });
              }
            });
          }
          const pid = session.pid;
          const runtime = pid === undefined ? null : await findProjectRuntimeDir(session.cwd);
          if (closed) return;
          if (!runtime || pid === undefined) {
            dropWatcher();
            detachViewer();
            emitState(BROWSER_OFFLINE);
            return;
          }
          if (!watcher || watcherWsUrl !== runtime.wsUrl) {
            dropWatcher();
            const started = await watchOwnedTargets(runtime.wsUrl, {
              getOwnedTargetIds: () => readOwnedTargetIds(runtime.runtimeDir, runtime.daemonName, pid),
              onOwnedTarget: () => {
                void tick();
              },
            }).catch(() => null);
            if (closed) {
              started?.close();
              return;
            }
            watcher = started;
            watcherWsUrl = started ? runtime.wsUrl : null;
          }
          const ownedIds = await readOwnedTargetIds(runtime.runtimeDir, runtime.daemonName, pid);
          if (closed) return;
          if (ownedIds.length === 0) {
            detachViewer();
            emitState({ status: 'no-tab', tabs: [] });
            return;
          }
          if (viewer && viewerWsUrl !== runtime.wsUrl) detachViewer();
          if (!viewer) {
            const handle = await openScreencast(runtime.wsUrl, {
              preferTargetId,
              getOwnedTargetIds: () => readOwnedTargetIds(runtime.runtimeDir, runtime.daemonName, pid),
              onFrame: emitFrame,
              onAction: (action) => emitAction(action),
              onState: (state) => {
                emitState(state);
                if (state.status === 'browser-offline') detachViewer();
              },
            });
            if (closed) {
              handle.close();
              return;
            }
            viewer = handle;
            viewerWsUrl = runtime.wsUrl;
          }
        } catch {
          // Transient fs/CDP failure: keep the stream open and retry next tick.
        } finally {
          tickInFlight = false;
        }
      };

      pollTimer = setInterval(() => {
        void tick();
      }, BROWSER_POLL_MS);
      void tick();

      return cleanup;
    },
  });

  return stream.response;
}
