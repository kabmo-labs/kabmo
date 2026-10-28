/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The unified realtime channel's shared state: the socket slot, its status,
 * the frame sink, and the two small helpers every other module of the channel
 * calls.
 *
 * Split from `connection.ts` (which owns the socket lifecycle) because the
 * lifecycle — dial, backoff, the resume probe — is a different concern from the
 * state it moves, and one file holding both crossed the repo's size ceiling.
 *
 * State lives on `globalThis` so a dev HMR re-evaluation adopts the live socket
 * instead of opening a second one against the same server.
 */

import {
  encodeClientFrame,
  type RealtimeClientFrame,
} from '@/shared/lib/realtime/protocol';

/**
 * `WebSocket.readyState` values, spelled out rather than read off the global:
 * the lifecycle may run against a constructor a test injected through
 * `setSocketConstructor`, and that object need not carry the statics.
 */
export const WS_CONNECTING = 0;
export const WS_OPEN = 1;

/**
 * `error` is deliberately absent: the channel never gives up, so a state that
 * means "stopped trying" would have no way back into `connecting`. A dead
 * channel reads `closed` (red) while a retry is pending.
 */
export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'closed';

/** The topics that should be subscribed once the socket is open. */
export type LiveTopicSource = () => string[];

/** Every inbound frame, as raw text, handed to the topic layer. */
export type FrameSink = (raw: string) => void;

export interface ConnectionState {
  socket: WebSocket | null;
  status: RealtimeStatus;
  statusListeners: Set<() => void>;
  /** Browser timer handle (`window.setTimeout`), so `clearTimeout` accepts it. */
  retryTimer: number | undefined;
  failures: number;
  /** A dial is wanted (someone is subscribed) but none is in flight. */
  wanted: boolean;
  /**
   * Socket constructor override, for a test that drives the channel through a
   * real listener. The default reads the global, which is what production
   * wants — but a test process shares that global with every other suite, so a
   * suite that stubs `WebSocket` would otherwise leave this client dialing a
   * stub that never opens.
   */
  socketCtor: typeof WebSocket | null;
  /**
   * Removes the tab-resume listeners. Kept on the state object rather than in a
   * module binding so a `bun --hot` re-evaluation cannot install a second set
   * against a socket the first one still owns.
   */
  wakeCleanup: (() => void) | null;
  /** Application-level liveness probe sent when a tab comes back. */
  probeId: number | undefined;
  probeTimer: number | undefined;
  probeSeq: number;
  /**
   * When the armed probe was sent.
   *
   * A probe armed before the page was frozen keeps its deadline timer frozen
   * with it, so `probeId` stays set forever and every later probe would return
   * early — the socket is then never abandoned and nothing ever re-dials. The
   * timestamp is what lets a probe that outlived its own deadline be discarded.
   */
  probeArmedAt: number;
  /**
   * When the last frame (or probe answer) arrived on the current socket.
   *
   * The watchdog compares this against `IDLE_PROBE_AFTER_MS` to decide whether
   * an OPEN socket has gone quiet — which is the ONLY signal available when the
   * browser never delivers a `close` (see `connection.ts`).
   */
  lastInboundAt: number;
  /** The watchdog interval. `undefined` until the first subscription. */
  livenessTimer: number | undefined;
}

/**
 * The topic layer's hooks, wired ONCE at import.
 *
 * Module scope rather than the resettable state object: a test teardown clears
 * the socket and its timers, and if these lived there too the client would come
 * back with no frame sink — every subsequent connection would open and silently
 * drop every frame.
 */
let frameSink: FrameSink | null = null;
let liveTopicSource: LiveTopicSource | null = null;
let closeHook: (() => void) | null = null;

declare global {
  // eslint-disable-next-line no-var
  var __kabmoRealtimeConnection: ConnectionState | undefined;
}

export function state(): ConnectionState {
  return (globalThis.__kabmoRealtimeConnection ??= {
    socket: null,
    status: 'idle',
    statusListeners: new Set(),
    retryTimer: undefined,
    failures: 0,
    wanted: false,
    socketCtor: null,
    wakeCleanup: null,
    probeId: undefined,
    probeTimer: undefined,
    probeSeq: 0,
    probeArmedAt: 0,
    lastInboundAt: 0,
    livenessTimer: undefined,
  });
}

/** The topic layer registers itself here at import. */
export function configureConnection(
  sink: FrameSink,
  liveTopics: LiveTopicSource,
  onClose: () => void,
): void {
  frameSink = sink;
  liveTopicSource = liveTopics;
  closeHook = onClose;
}

/** Hand one inbound frame to the topic layer. */
export function deliverFrame(raw: string): void {
  frameSink?.(raw);
}

/** The topics that should be subscribed right now. */
export function liveTopics(): string[] {
  return liveTopicSource?.() ?? [];
}

/** Called when the socket went away, so every cached value is of unknown age. */
export function notifyClosed(): void {
  closeHook?.();
}

/**
 * Override the socket constructor. Test-only: a suite driving the channel
 * through a real listener injects the runner's own `WebSocket`, so another
 * suite's stub cannot capture its dial.
 */
export function setSocketConstructor(ctor: typeof WebSocket | null): void {
  state().socketCtor = ctor;
}

export function setStatus(next: RealtimeStatus): void {
  const host = state();
  if (host.status === next) return;
  host.status = next;
  for (const listener of [...host.statusListeners]) listener();
}

export function currentStatus(): RealtimeStatus {
  return state().status;
}

export function onStatusChange(listener: () => void): () => void {
  const host = state();
  host.statusListeners.add(listener);
  return () => host.statusListeners.delete(listener);
}

/** Send one control frame. False when the socket is not open. */
export function send(frame: RealtimeClientFrame): boolean {
  const socket = state().socket;
  if (!socket || socket.readyState !== WS_OPEN) return false;
  try {
    socket.send(encodeClientFrame(frame));
    return true;
  } catch {
    return false;
  }
}

/** Whether a dial is wanted right now (someone has a subscription). */
export function setWanted(wanted: boolean): void {
  state().wanted = wanted;
}
