/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The participant hooks: what lets a plugin ACT on the conversation.
 *
 * `usePanelInfo` and friends make a plugin a view — it draws into a slot and
 * reads per-session state. These three make it a participant, and each reads
 * the host's own machinery rather than a second copy of it:
 *
 * - `useRpc` calls the plugin's OWN server method, through the route the server
 *   half already answers on.
 * - `useRealtime` subscribes to the plugin's own `plugin:<id>` topic, on the
 *   same hub every built-in panel reads.
 * - `useComposer` reads and writes the composer's draft.
 *
 * Every one of them goes through `requireServices()`, so a plugin outside the
 * app throws naming the real problem instead of failing obscurely, and the test
 * harness answers them with fakes — a plugin's own tests never need a host.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { requireServices, type ComposerState, type PluginRpcError, type PluginRpcOutcome } from './services';
import { usePluginId } from './plugin-id';

/**
 * Call one of this plugin's server methods.
 *
 * The plugin id comes from the HOST, never from the caller: a plugin that built
 * its own URL would call another plugin's method the day the two disagreed
 * about the id, and the host is the one party that cannot be wrong about which
 * plugin it is running.
 *
 * Three behaviours, each of which is a bug if missed:
 *
 * - **A plugin's refusal is a RESULT, not a thrown error.** The route answers
 *   `{ ok: false, error }` at HTTP 200, because the call reached the plugin and
 *   the plugin said no. Flattening that into a rejected promise would turn "the
 *   plugin refused this argument" into "the network broke", which is the one
 *   distinction the route exists to preserve.
 * - **A superseded call is dropped.** Two calls in flight must not leave the
 *   first one's value on screen, so each call carries a sequence number and a
 *   late answer for an older one is discarded.
 * - **`pending` is per-hook, not per-call.** A panel wants one spinner, not one
 *   per in-flight request.
 */
export interface RpcState<In, Out> {
  /** Invoke the method. Resolves with the outcome; never throws for a refusal. */
  call: (input: In) => Promise<PluginRpcOutcome>;
  /** The last successful value, kept while a newer call is in flight. */
  value: Out | null;
  /** The last refusal, or null. Cleared by a successful call. */
  error: PluginRpcError | null;
  /** A call is in flight. */
  pending: boolean;
}

export function useRpc<In = unknown, Out = unknown>(method: string): RpcState<In, Out> {
  const [value, setValue] = useState<Out | null>(null);
  const [error, setError] = useState<PluginRpcError | null>(null);
  const [pending, setPending] = useState(false);
  // The plugin this component belongs to, from the host's context — which is
  // what makes `method` the only thing a plugin names.
  const pluginId = usePluginId();
  // The newest call's sequence. An answer for anything older is dropped, so a
  // slow first call cannot repaint the panel a faster second one already moved.
  const sequence = useRef(0);

  const call = useCallback(
    async (input: In): Promise<PluginRpcOutcome> => {
      const services = requireServices();
      const mine = ++sequence.current;
      setPending(true);
      const outcome: PluginRpcOutcome =
        services.callRpc && pluginId
          ? await services.callRpc(pluginId, method, input)
          : { ok: false, error: { code: 'no_plugin', message: 'This component is not inside a plugin.' } };
      if (mine !== sequence.current) return outcome;
      setPending(false);
      if (outcome.ok) {
        setValue(outcome.value as Out);
        setError(null);
      } else {
        setError(outcome.error);
      }
      return outcome;
    },
    [method, pluginId],
  );

  return { call, value, error, pending };
}

/**
 * The plugin's own realtime topic, as a value that re-renders on each push.
 *
 * `stale` is surfaced rather than hidden: it means the socket is down, and a
 * panel showing a value of unknown age as if it were current is worse than one
 * that says so.
 */
export interface PluginRealtimeState<T> {
  value: T | null;
  /** No value has arrived yet. */
  isLoading: boolean;
  /** The value on hand is not known to be current. */
  stale: boolean;
  /** Ask the server for a fresh snapshot. */
  refresh: () => void;
}

export function useRealtime<T = unknown>(): PluginRealtimeState<T> {
  const [value, setValue] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const pluginId = usePluginId();

  useEffect(() => {
    const services = requireServices();
    if (!pluginId || !services.subscribePluginTopic) return;
    // ONE writer for the seed and every push, because the host's answer for a
    // topic with no value yet is `undefined` — and `undefined` is not a value
    // this hook may hand out. `value` is declared `T | null`, so a component
    // that guards `value !== null` and then reads a field is correct by this
    // contract, and an `undefined` smuggled through it throws inside that
    // component's render.
    //
    // Measured, and it is not hypothetical: a plugin's navbar readout guarded
    // exactly that way threw `Cannot read properties of undefined (reading
    // 'probe')` after a server restart. The socket's resync notifies every
    // watched topic, and a topic whose server half had not published yet
    // answered `undefined`. The throw landed inside the app's ROOT diff, which
    // left the container's vnode bookkeeping half-written — and the next queued
    // render then appended a SECOND app tree, so the navbar drew twice until a
    // reload.
    const apply = (next: unknown): void => {
      setValue(next === undefined ? null : (next as T));
      setIsLoading(false);
      setStale(services.pluginTopicStale?.(pluginId) ?? false);
    };
    // Seed from the host's current value BEFORE subscribing: a component that
    // mounted between two pushes would otherwise render empty until the next
    // one, which for a slow-publishing plugin is a visible blank.
    const seeded = services.readPluginTopic?.(pluginId);
    if (seeded !== undefined) apply(seeded);
    else setStale(services.pluginTopicStale?.(pluginId) ?? false);
    const unsubscribe = services.subscribePluginTopic(pluginId, apply);
    return unsubscribe;
  }, [pluginId]);

  const refresh = useCallback(() => {
    if (pluginId) requireServices().refreshPluginTopic?.(pluginId);
  }, [pluginId]);

  return { value, isLoading, stale, refresh };
}

/**
 * The composer: its live state, and its writes.
 *
 * A write goes through the host's own composer state, NOT the DOM. The composer
 * is a controlled textarea owned by the chat, so a DOM write is reverted by the
 * next keystroke and the plugin's edit vanishes with no error — the failure
 * this hook exists to prevent.
 *
 * The read is reactive and the write is immediate, which is what makes
 * `insert('@')` a one-step operation rather than an await.
 */
export interface ComposerHandle extends ComposerState {
  set(text: string): void;
  insert(text: string): void;
  focus(): void;
}

export function useComposer(): ComposerHandle {
  const [state, setState] = useState<ComposerState>(() => {
    const composer = requireServices().composer?.();
    return composer ?? { text: '', isEmpty: true, isSubmitting: false, scope: { kind: 'new', sessionId: null } };
  });

  useEffect(() => {
    const services = requireServices();
    if (!services.subscribeComposer) return;
    return services.subscribeComposer(setState);
  }, []);

  const set = useCallback((text: string) => {
    requireServices().composer?.().set(text);
  }, []);
  const insert = useCallback((text: string) => {
    requireServices().composer?.().insert(text);
  }, []);
  const focus = useCallback(() => {
    requireServices().composer?.().focus();
  }, []);

  return { ...state, set, insert, focus };
}
