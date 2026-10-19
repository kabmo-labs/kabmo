/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The LIST slots, as a host surface reads them.
 *
 * The store (`@/client/lib/plugins/list-slots`) already merges across plugins
 * and sorts by `order`; this hook only makes that read reactive. It deliberately
 * does NOT cache or re-sort, because `listSlotRows` is the single implementation
 * of the merge order and a second one here is a place for the two to disagree.
 *
 * `useState` + `subscribe` rather than `useSyncExternalStore`: the read returns
 * a fresh array each time, and an external store would call the snapshot twice
 * per render and see two different identities, which Preact treats as a change
 * on every render.
 */

import { useEffect, useState } from 'preact/hooks';
import type { KeyedRegistration, ListSlotName, SlotContextProps } from '@kabmo-labs/kabmo-sdk';
import { listSlotRows, subscribeListSlots, type ListSlotRows } from '@/client/lib/plugins/list-slots';
import { pluginContext, subscribePluginContext } from '@/client/lib/plugins/context';

/** One slot's rows, merged across plugins and re-read whenever any row changes. */
export function useListSlotRows<T extends KeyedRegistration = KeyedRegistration>(
  slot: ListSlotName,
): ListSlotRows<T> {
  const [rows, setRows] = useState<ListSlotRows<T>>(() => listSlotRows<T>(slot));
  useEffect(() => {
    // Re-read on mount/slot change as well as on publish: a row registered
    // between this render and the effect's run would otherwise be missed.
    setRows(listSlotRows<T>(slot));
    return subscribeListSlots(() => setRows(listSlotRows<T>(slot)));
  }, [slot]);
  return rows;
}

/**
 * The session/workspace every list-slot component is given.
 *
 * Read from the context the layout PUBLISHES (`pluginContext`) rather than from
 * a surface's own props: a surface can be mounted anywhere in the tree, and only
 * the layout knows the active session.
 */
export function usePluginSlotContext(): SlotContextProps {
  const [context, setContext] = useState<SlotContextProps>(() => {
    const { sessionId, workspacePath } = pluginContext();
    return { sessionId, workspacePath };
  });
  useEffect(
    () =>
      subscribePluginContext((next) =>
        setContext({ sessionId: next.sessionId, workspacePath: next.workspacePath }),
      ),
    [],
  );
  return context;
}
