/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { PluginCatalogItem, PluginItem, PluginMarketplaceItem } from '@/shared/types';

export interface PluginPayload {
  plugins: PluginItem[];
  marketplaces: PluginMarketplaceItem[];
  catalog: PluginCatalogItem[];
}

export interface PluginSettingsData extends PluginPayload {
  isLoading: boolean;
  /** Label of the action in flight, so the pane can name what it is waiting on. */
  busy: string | null;
  error: string | null;
  /** Re-read the current scope from omp's registries. */
  refresh: () => Promise<void>;
  /** One mutating action; `label` is what the pane shows while it runs. */
  run: (label: string, body: Record<string, unknown>) => Promise<boolean>;
  clearError: () => void;
}

/**
 * The Plugins panel's data.
 *
 * Every mutation goes through the same POST and answers with the WHOLE payload,
 * because each one changes more than the row it names: installing a plugin also
 * moves the catalog's `installed` flag and can add a lockfile entry, uninstalling
 * can drop a shared cache directory another scope referenced, and an upgrade can
 * change the version a second scope sees. Refetching per action and diffing the
 * response client-side would be a second source of truth for state omp already
 * reports — so the server's answer is adopted verbatim.
 */
export function usePluginSettings(scopeQuery: string): PluginSettingsData {
  const [payload, setPayload] = useState<PluginPayload>({ plugins: [], marketplaces: [], catalog: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/settings/plugins${scopeQuery}`);
      const data = await res.json();
      setPayload({
        plugins: Array.isArray(data?.plugins) ? data.plugins : [],
        marketplaces: Array.isArray(data?.marketplaces) ? data.marketplaces : [],
        catalog: Array.isArray(data?.catalog) ? data.catalog : [],
      });
      if (data?.error) setError(String(data.error));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [scopeQuery]);

  useEffect(() => {
    setIsLoading(true);
    refresh().catch(console.error);
  }, [refresh]);

  const run = useCallback(
    async (label: string, body: Record<string, unknown>) => {
      setBusy(label);
      setError(null);
      try {
        const res = await fetch(`/api/settings/plugins${scopeQuery}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data?.success) {
          // omp's own sentence, verbatim: it names the missing marketplace, the
          // ambiguous scope or the bad source format, none of which Kabmo
          // could reconstruct.
          setError(typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`);
          return false;
        }
        if (Array.isArray(data.plugins)) {
          setPayload({
            plugins: data.plugins,
            marketplaces: Array.isArray(data.marketplaces) ? data.marketplaces : [],
            catalog: Array.isArray(data.catalog) ? data.catalog : [],
          });
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [scopeQuery],
  );

  const clearError = useCallback(() => setError(null), []);

  return { ...payload, isLoading, busy, error, refresh, run, clearError };
}

/**
 * The scope body for an action on ONE plugin.
 *
 * A plugin's own scope decides it, never the panel's: omp lists a user install
 * even while a project install shadows it, and `--scope user` is what tells omp
 * which of the two to enable or remove. A `package` plugin (npm/git/link) is
 * resolved by NAME against the active project root first and the user root
 * second, so it takes no scope at all — the flag is only honoured on the
 * marketplace path.
 */
export function pluginScopeBody(plugin: PluginItem, workspace: string | null): Record<string, unknown> {
  if (plugin.kind !== 'marketplace') return {};
  if (plugin.scope === 'project' && workspace) return { scope: 'project', root: workspace };
  return { scope: 'user' };
}
