/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A plugin's event surface.
 *
 * The Kabmo's signal bus is a CLOSED union (`RealtimeSignal`), and that is a
 * property worth keeping: a listener for a name that does not exist is a
 * subscription to nothing, and the union is what makes the compiler say so for
 * Kabmo's own code. A plugin's event names are therefore held in their
 * own map rather than being forced into the union — a plugin may announce any
 * name, and two plugins announcing `ready` are two channels because the plugin
 * id is part of the key.
 *
 * What a plugin does NOT get is a name that collides with Kabmo's own.
 * Every key here is prefixed, so `ready` from a plugin can never reach a
 * listener Kabmo registered for its own `ready`.
 */

import type { PluginEventsApi, PluginJson } from '@kabmo-labs/kabmo-sdk';

type Listener = (payload: PluginJson | undefined) => void;

/**
 * The listeners, keyed `<pluginId>\0<name>`.
 *
 * Process-wide for the same reason every other plugin registry is: under
 * `bun --hot` this module re-evaluates while a loaded plugin still holds the
 * unsubscribe it was handed, and a module-level map would come back empty —
 * the unsubscribe would then be a no-op against a registry nobody reads.
 */
declare global {
  // eslint-disable-next-line no-var
  var __kabmoPluginEventListeners: Map<string, Set<Listener>> | undefined;
}

const eventKey = (pluginId: string, name: string) => `${pluginId}\u0000${name}`;

function listeners(): Map<string, Set<Listener>> {
  return (globalThis.__kabmoPluginEventListeners ??= new Map());
}

/** The API one plugin is handed at load. */
export function createPluginEvents(pluginId: string): PluginEventsApi {
  return {
    on<T = PluginJson>(name: string, listener: (payload: T) => void) {
      const map = listeners();
      const key = eventKey(pluginId, name);
      const set = map.get(key) ?? new Set<Listener>();
      set.add(listener as Listener);
      map.set(key, set);
      return () => {
        set.delete(listener as Listener);
        // The empty set is removed rather than kept: a plugin that unsubscribes
        // everything should not leave a key behind that a later listener would
        // find already present.
        if (set.size === 0) map.delete(key);
      };
    },
    emit(name, payload) {
      // A throwing listener never stops the others — the rule Kabmo's own
      // signal bus follows, for the same reason: this sits on a write path.
      for (const listener of [...(listeners().get(eventKey(pluginId, name)) ?? [])]) {
        try {
          listener(payload);
        } catch {
          // Deliberately swallowed: see above.
        }
      }
    },
  };
}

/** Drop every listener a plugin registered — called from its disposal pass. */
export function clearPluginEvents(pluginId: string): void {
  const map = listeners();
  const prefix = `${pluginId}\u0000`;
  for (const key of [...map.keys()]) {
    if (key.startsWith(prefix)) map.delete(key);
  }
}

/** Test seam: forget every registration. */
export function resetPluginEvents(): void {
  listeners().clear();
}
