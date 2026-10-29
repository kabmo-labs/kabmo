import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';
import type { BrowserPanelAction, BrowserTabInfo, BrowserViewFrame, BrowserViewState, BrowserViewStatus } from '@/shared/types';

interface UseScreencastResult {
  status: BrowserViewStatus;
  url?: string;
  title?: string;
  tabs: BrowserTabInfo[];
  targetId?: string;
  /**
   * The newest frame, as the payload the canvas painter decodes.
   *
   * NOT a `data:` URL handed to an `<img>`: WebKit never releases the decoded
   * image behind a replaced `src`, measured at ~76 KB of WebContent footprint
   * per frame (and ~123 KB for a revoked blob URL), which is gigabytes over a
   * long session. See `lib/browser/frame-canvas.ts` for the numbers.
   */
  frame?: { data: string; mimeType: string } | null;
  actions: BrowserPanelAction[];
  /** Pin the viewer to one tab id; pass an empty string to follow the newest owned tab. */
  selectTarget: (targetId: string) => void;
  /** Drop the current SSE connection and open a fresh one. */
  reconnect: () => void;
}

const INITIAL_STATE: BrowserViewState = { status: 'agent-offline', tabs: [] };
const MAX_RETRY_DELAY_MS = 5_000;
const TOAST_VISIBLE_MS = 4_000;
const TOAST_DRAIN_MS = 500;
const MAX_VISIBLE_ACTIONS = 3;
const MAX_QUEUED_ACTIONS = 16;

type VisibleAction = BrowserPanelAction & { expiresAt: number };

/**
 * Live screencast of the browser tab this session's agent is driving, plus the
 * activity toasts parsed from agent intents and live page interactions.
 *
 * Opens an EventSource against `/api/browser/:sessionId/stream`, keeps only the
 * newest frame in memory, and reconnects with capped backoff when the stream is
 * closed. The server never 404s: status changes arrive as `state` events.
 *
 * `active=false` (panel hidden on desktop/mobile) fully closes the EventSource
 * instead of letting it idle — the server-side viewer/watcher release through
 * the request-abort close path — and reconnects once when the panel activates.
 * No reconnect timers run while paused.
 */
export function useScreencast(active = true): UseScreencastResult {
  const { sessionId, ready } = useSessionStateContext();
  const [state, setState] = useState<BrowserViewState>(INITIAL_STATE);
  const [frame, setFrame] = useState<{ data: string; mimeType: string } | null>(null);
  const [actions, setActions] = useState<VisibleAction[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string>('');
  const [nonce, setNonce] = useState(0);

  const sourceRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTargetRef = useRef<string | undefined>(undefined);
  const attemptRef = useRef(0);
  const queueRef = useRef<BrowserPanelAction[]>([]);

  const selectTarget = useCallback((targetId: string) => {
    setSelectedTarget(targetId.trim());
  }, []);

  const reconnect = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  // Pace queued actions into visible toasts (one per tick) and expire old ones.
  useEffect(() => {
    const timer = setInterval(() => {
      setActions((prev) => {
        const now = Date.now();
        const alive = prev.filter((action) => action.expiresAt > now);
        const next = queueRef.current.shift();
        if (!next) return alive.length === prev.length ? prev : alive;
        return [...alive.slice(-(MAX_VISIBLE_ACTIONS - 1)), { ...next, expiresAt: now + TOAST_VISIBLE_MS }];
      });
    }, TOAST_DRAIN_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setState(INITIAL_STATE);
    setFrame(null);
    setSelectedTarget('');
    queueRef.current = [];
    setActions([]);
  }, [sessionId]);

  useEffect(() => {
    if (!ready || !sessionId || !active) return;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const query = selectedTarget ? `?target=${encodeURIComponent(selectedTarget)}` : '';
      const source = new EventSource(`/api/browser/${encodeURIComponent(sessionId)}/stream${query}`);
      sourceRef.current = source;

      source.addEventListener('open', () => {
        attemptRef.current = 0;
      });

      source.addEventListener('state', (event) => {
        try {
          const next = JSON.parse((event as MessageEvent).data) as BrowserViewState;
          if (next.targetId !== currentTargetRef.current) setFrame(null);
          currentTargetRef.current = next.targetId;
          setState(next);
          if (next.status !== 'live') setFrame(null);
        } catch {
          // Ignore malformed state frames.
        }
      });

      source.addEventListener('frame', (event) => {
        try {
          const incoming = JSON.parse((event as MessageEvent).data) as BrowserViewFrame;
          const current = currentTargetRef.current;
          if (current && incoming.targetId && incoming.targetId !== current) return;
          setFrame({ data: incoming.data, mimeType: incoming.mimeType });
        } catch {
          // Ignore malformed frame payloads.
        }
      });

      source.addEventListener('action', (event) => {
        try {
          const action = JSON.parse((event as MessageEvent).data) as BrowserPanelAction;
          if (typeof action?.label !== 'string' || !action.label) return;
          queueRef.current.push(action);
          if (queueRef.current.length > MAX_QUEUED_ACTIONS) {
            queueRef.current.splice(0, queueRef.current.length - MAX_QUEUED_ACTIONS);
          }
        } catch {
          // Ignore malformed action payloads.
        }
      });

      source.addEventListener('error', () => {
        // EventSource reconnects on transient drops by itself; only a fatal
        // close (server closed the stream) needs a fresh instance.
        if (source.readyState === EventSource.CLOSED) scheduleReconnect();
      });
    };

    const scheduleReconnect = () => {
      if (disposed || retryRef.current) return;
      const attempt = Math.min(attemptRef.current + 1, MAX_RETRY_DELAY_MS / 1_000);
      attemptRef.current = attempt;
      retryRef.current = setTimeout(() => {
        retryRef.current = null;
        sourceRef.current?.close();
        sourceRef.current = null;
        connect();
      }, Math.min(attempt * 1_000, MAX_RETRY_DELAY_MS));
    };

    connect();

    return () => {
      disposed = true;
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [ready, sessionId, selectedTarget, nonce, active]);

  return {
    status: state.status,
    url: state.url,
    title: state.title,
    tabs: state.tabs,
    targetId: state.targetId,
    frame,
    actions,
    selectTarget,
    reconnect,
  };
}
