/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `messageDirective` slot, as the markdown renderer reads it.
 *
 * A hook rather than a plain lookup because the answer has to be REACTIVE: a
 * bundle that registers a directive after a message rendered must still reach
 * it, and a plugin loaded lazily is the normal case rather than an edge one.
 *
 * The lookup is by fence name and EXACT, which the store already enforces
 * across plugins (`GLOBALLY_KEYED_SLOTS`) — so a name resolves to one plugin at
 * most, and this returns the first row whose registration claims it.
 *
 * The result is memoized on the row list so it is a stable dependency for the
 * renderer's hydration effect: a new function identity per render would re-run
 * the effect on every keystroke of a streaming answer.
 */

import { useCallback, useMemo } from 'preact/hooks';
import type { MessageDirectiveRegistration, SlotContextProps } from '@kabmo-labs/plugin-sdk';
import type { ListSlotEntry } from '@/client/lib/plugins/list-slots';
import { useListSlotRows, usePluginSlotContext } from '@/client/hooks/workspace/list-slots';
import type { DirectiveRenderer } from '@/client/lib/plugins/directives';

/** Resolve a fence name to the plugin that claims it, or undefined. */
export function useDirectiveRenderer(): (name: string) => DirectiveRenderer | undefined {
  const rows = useListSlotRows<MessageDirectiveRegistration>('messageDirective');
  // One map per row list, not a scan per fence: a message with twenty
  // directives would otherwise walk the registry twenty times per render.
  const byName = useMemo(() => {
    const map = new Map<string, DirectiveRenderer>();
    for (const entry of rows as readonly ListSlotEntry<MessageDirectiveRegistration>[]) {
      // The registration's `name` is the fence token; `id` keys the row.
      if (!map.has(entry.registration.name)) {
        map.set(entry.registration.name, { pluginId: entry.pluginId, registration: entry.registration });
      }
    }
    return map;
  }, [rows]);
  return useCallback((name: string) => byName.get(name), [byName]);
}

/**
 * The published session and workspace, for a directive component's props.
 *
 * Read HERE rather than inside the hydrator so the consumer is the same hook
 * every other list-slot surface uses — a directive is a slot, not a special
 * case of one.
 */
export function useDirectiveContext(): SlotContextProps {
  return usePluginSlotContext();
}
