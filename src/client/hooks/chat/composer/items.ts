/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer popup's item source.
 *
 * A `/` popup is two lists in one: the commands loaded over RPC
 * (`loadComposerItems`) and the commands plugins contribute through the
 * `commandPaletteAction` slot. They are merged HERE rather than in the shared
 * loader, because the shared loader is a plain async function with no access to
 * the client's plugin store — and the store must be read reactively: a plugin
 * whose bundle finishes loading while the popup is open has to appear without
 * the composer remounting.
 *
 * Plugin rows are appended, not prepended: Kabmo's own commands lead (see
 * `mergeCommandAndSkillItems`), and appending is enough because the popup
 * re-filters the whole pool on every keystroke.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { CommandPaletteRegistration } from '@kabmo-labs/kabmo-sdk';
import type { ComposerPickItem, ComposerPickKind } from '@/shared/types';
import { loadComposerItems } from '@/shared/lib/chat/composer/client';
import type { ListSlotRows } from '@/client/lib/plugins/list-slots';
import { useListSlotRows } from '@/client/hooks/workspace/list-slots';

interface ComposerItemsState {
  items: ComposerPickItem[];
  loading: boolean;
  error: string | null;
}

/**
 * A plugin command as a popup row. The id is namespaced by plugin as well as by
 * registration id, because the slot only requires an id unique WITHIN a plugin.
 * The hint is folded into the description exactly as omp renders an argument
 * hint, so a plugin command reads like a builtin.
 */
function pluginCommandItems(rows: ListSlotRows<CommandPaletteRegistration>): ComposerPickItem[] {
  return rows.map(({ pluginId, registration }) => ({
    id: `plugin-command-${pluginId}-${registration.id}`,
    name: registration.command,
    description: registration.hint
      ? `${registration.hint} - ${registration.description}`
      : registration.description,
    kind: 'command',
    source: 'command',
    token: `/${registration.command}`,
    ...(registration.hint ? { inputHint: registration.hint } : {}),
  }));
}

/** Fetch composer pick items for a kind; null kind skips the fetch. */
export function useComposerItems(
  kind: ComposerPickKind | null,
  root?: string | null,
): ComposerItemsState {
  const [state, setState] = useState<ComposerItemsState>({ items: [], loading: false, error: null });
  const pluginRows = useListSlotRows<CommandPaletteRegistration>('commandPaletteAction');

  useEffect(() => {
    if (!kind) {
      setState({ items: [], loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ items: [], loading: true, error: null });

    loadComposerItems(kind, root ?? null)
      .then((items) => {
        if (cancelled) return;
        setState({ items, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          items: [],
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [kind, root]);

  // Merged outside the fetch effect so a late registration re-renders the popup
  // without re-issuing the request; memoized on the two inputs so the popup's
  // own filter memo is not invalidated on every unrelated render.
  const items = useMemo(
    () => (kind === 'command' ? [...state.items, ...pluginCommandItems(pluginRows)] : state.items),
    [kind, state.items, pluginRows],
  );

  return { items, loading: state.loading, error: state.error };
}
