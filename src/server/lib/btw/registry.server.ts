/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Process-wide BTW registry: the live topic runtimes, the per-session
 * subscriber fan-out, and the single place that assembles a session's BTW
 * state.
 *
 * It hangs off `globalThis` for the same reason the omp session registry does:
 * a `bun --hot` reload re-evaluates modules but keeps `globalThis`, so a
 * surviving side child stays reachable instead of being orphaned.
 *
 * Reading the state is also the repair point: a turn row still marked
 * `running` whose runtime is gone (the server restarted, or the child was
 * killed) is settled as `interrupted` instead of blocking every later
 * question behind a turn that can never finish.
 */

import { listBtwTopics, settleRunningBtwTurns } from '@/server/lib/btw/store.server';
import { BtwRuntime, type BtwRuntimeContext } from '@/server/lib/btw/runtime.server';
import type { BtwFrame, BtwState, BtwTopic } from '@/shared/types';

interface BtwRegistryHost {
  runtimes: Map<string, BtwRuntime>;
  listeners: Map<string, Set<(frame: BtwFrame) => void>>;
}

declare global {
  // eslint-disable-next-line no-var
  var __ompBtwRegistry: BtwRegistryHost | undefined;
}

function registry(): BtwRegistryHost {
  globalThis.__ompBtwRegistry ??= { runtimes: new Map(), listeners: new Map() };
  return globalThis.__ompBtwRegistry;
}

export function getBtwRuntime(topicId: string): BtwRuntime | undefined {
  return registry().runtimes.get(topicId);
}

/** Every runtime belonging to a session (at most a handful of topics). */
function sessionBtwRuntimes(sessionId: string): BtwRuntime[] {
  const found: BtwRuntime[] = [];
  for (const runtime of registry().runtimes.values()) {
    if (runtime.sessionId === sessionId) found.push(runtime);
  }
  return found;
}

/** The runtime currently carrying a turn for this session, if any. */
export function findRunningBtwRuntime(sessionId: string): BtwRuntime | undefined {
  return sessionBtwRuntimes(sessionId).find((runtime) => runtime.running);
}

/** Get (or create) the runtime for a topic, wiring its output to the session's
 *  subscribers. */
export function ensureBtwRuntime(context: BtwRuntimeContext): BtwRuntime {
  const host = registry();
  const existing = host.runtimes.get(context.topicId);
  if (existing) return existing;
  const runtime = new BtwRuntime(context, {
    publish: (frame) => publishBtw(context.sessionId, frame),
    stateChanged: () => {
      void publishBtwState(context.sessionId);
    },
  });
  host.runtimes.set(context.topicId, runtime);
  return runtime;
}

export function forgetBtwRuntime(topicId: string): void {
  registry().runtimes.delete(topicId);
}

/** Fan out one frame to everyone watching this session's btw stream. */
export function publishBtw(sessionId: string, frame: BtwFrame): void {
  const listeners = registry().listeners.get(sessionId);
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener(frame);
    } catch {
      // A throwing subscriber (closed socket, encode failure) must not starve
      // the remaining ones.
    }
  }
}

export function subscribeBtw(sessionId: string, listener: (frame: BtwFrame) => void): () => void {
  const host = registry();
  let listeners = host.listeners.get(sessionId);
  if (!listeners) {
    listeners = new Set();
    host.listeners.set(sessionId, listeners);
  }
  listeners.add(listener);
  return () => {
    const current = host.listeners.get(sessionId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) host.listeners.delete(sessionId);
  };
}

/** The session's BTW state, with stale `running` rows repaired. */
export async function btwStateFor(sessionId: string): Promise<BtwState> {
  const topics = await listBtwTopics(sessionId);
  // A runtime that is mid-`settle()` has already cleared its turn index but has
  // not written the row yet; counting it as gone would race its own UPDATE and
  // rewrite a completed turn as `interrupted`. `busy` covers that window.
  const runtimes = sessionBtwRuntimes(sessionId);
  const liveTopicIds = new Set(
    runtimes.filter((runtime) => runtime.running || runtime.busy).map((runtime) => runtime.topicId),
  );

  const stale = topics.filter((topic) => topic.turns.some((turn) => turn.status === 'running') && !liveTopicIds.has(topic.id));
  if (stale.length > 0) {
    await Promise.all(stale.map((topic) => settleRunningBtwTurns(topic.id, 'interrupted')));
  }

  const repaired: BtwTopic[] = topics.map((topic) =>
    liveTopicIds.has(topic.id)
      ? topic
      : { ...topic, turns: topic.turns.map((turn) => (turn.status === 'running' ? { ...turn, status: 'interrupted' as const } : turn)) },
  );

  const liveRuntime = runtimes.find((runtime) => runtime.running);
  return {
    topics: repaired,
    runningTopicId: repaired.find((topic) => topic.turns.some((turn) => turn.status === 'running'))?.id ?? null,
    live: liveRuntime?.liveTurn() ?? null,
  };
}

/** Republish the whole state to the session's subscribers. */
export async function publishBtwState(sessionId: string): Promise<void> {
  const state = await btwStateFor(sessionId);
  publishBtw(sessionId, { type: 'btw_state', state });
}
