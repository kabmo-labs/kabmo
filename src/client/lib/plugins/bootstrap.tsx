import { useEffect } from 'preact/hooks';
import { useRef } from 'preact/hooks';
import { usePanelRegistry } from '@/client/hooks/workspace/panel-registry';
import { setPluginContext } from '@/client/lib/plugins/context';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { useListSlotRows } from '@/client/hooks/workspace/list-slots';
import type { ContentScriptRegistration } from '@kabmo-labs/plugin-sdk';
import {
  mountContentScripts,
  unmountAllContentScripts,
  unmountContentScripts,
} from '@/client/lib/plugins/content-scripts';
import { reconcilePluginStylesheets } from '@/client/lib/plugins/stylesheets';

/**
 * Boot the plugin system, once, from the layout.
 *
 * Three things have to happen before a plugin can contribute anything:
 *
 * 1. The registry read, which names the bundles to import. The import runs each
 *    plugin's `setup`, and that is what registers its components.
 * 2. The context the components read, published from here because it comes from
 *    the SESSION the layout owns — a plugin cannot resolve it, and a surface
 *    that forgot to publish it would show "no workspace" over a real one.
 * 3. The content scripts, mounted per plugin. They render nothing, so no slot
 *    surface can own them; this is the earliest point that knows both the
 *    registrations and a document to mount into.
 *
 * Mounted at the top of the workspace, so all three are in place before any
 * panel that would draw a plugin.
 */
export function PluginBootstrap({ workspacePath }: { workspacePath: string | null }) {
  const { sessionId } = useSessionStateContext();

  // The read is what triggers the imports; nothing else has to call it, and
  // calling it twice would be one request behind a shared cache.
  usePanelRegistry();

  useEffect(() => {
    setPluginContext(sessionId ?? null, workspacePath);
  }, [sessionId, workspacePath]);

  useContentScripts();
  usePluginStylesheets();

  return null;
}

/**
 * Load a plugin's declared stylesheet while it has a live content-script
 * generation, and unload it when it does not.
 *
 * A plugin's imported CSS is otherwise inert (see `stylesheets.ts`), so this is
 * what makes `css` in the manifest do anything. The gate is the content-script
 * registration itself: a plugin that ships app-shell styling mounts app-shell
 * code, and one that renders only into a slot uses the host's own utilities and
 * needs no stylesheet of its own.
 *
 * Reconciled from the whole registry payload rather than per plugin, so a
 * plugin that was disabled or removed loses its `<link>` in the same pass. The
 * RULES are scoped now (the server wraps every stylesheet in
 * `@scope ([data-plugin-surface="<id>"])`), but the link still has to go: a
 * switched-off plugin must stop shipping bytes, and an unloaded one must not
 * keep a stale stylesheet alive.
 */
function usePluginStylesheets(): void {
  const { panels } = usePanelRegistry();
  const rows = useListSlotRows<ContentScriptRegistration>('contentScript');
  // A stable signature: the same live set must not churn the links on every
  // render, and a rebuild's new URL is already handled by the loader.
  const livePlugins = [...new Set(rows.map((row) => row.pluginId))].sort().join('|');
  const signature = panels
    .map((panel) => `${panel.pluginId}:${panel.cssUrl ?? ''}`)
    .sort()
    .join('|');

  useEffect(() => {
    const withContentScripts = new Set(livePlugins ? livePlugins.split('|') : []);
    reconcilePluginStylesheets(
      panels
        .filter((panel) => withContentScripts.has(panel.pluginId))
        .map((panel) => ({ pluginId: panel.pluginId, cssUrl: panel.cssUrl })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, livePlugins]);
}

/**
 * Mount each plugin's content scripts, and take down the ones that go away.
 *
 * Mounting is a REPLACEMENT per plugin (`mountContentScripts` disposes that
 * plugin's previous generation first), so the effect only has to mount what is
 * registered now and unmount what is no longer there — taking everything down
 * on every change would tear down a script that is still registered and
 * immediately mount it again, which is a visible flash and a lost listener
 * registration for the script that did nothing wrong.
 *
 * **The live set is the REGISTRY's, not the slot store's.** The slot rows are
 * what a bundle registered, and nothing clears them when a plugin is switched
 * off — only a re-import does (`clearPluginListSlots`). Keying the effect on
 * the rows alone therefore left a disabled plugin's content script mounted:
 * its `<link>` was removed (that hook reads `panels`) while its DOM, listeners
 * and scoping attribute stayed until a reload. The registry payload is the
 * whole truth about which plugins are live, so it is what the reconcile reads.
 *
 * The dependency is a SIGNATURE rather than the row array: a re-read that
 * produces the same rows is the same set of scripts, and re-running for it
 * would churn every generation for nothing.
 *
 * Reported, never thrown: a script that cannot mount is a plugin bug, and it
 * must not take the chamber's boot with it.
 */
function useContentScripts(): void {
  const { panels } = usePanelRegistry();
  const rows = useListSlotRows<ContentScriptRegistration>('contentScript');
  const enabled = panels.map((panel) => panel.pluginId).sort().join('|');
  const signature = rows.map((row) => `${row.pluginId}:${row.registration.id}`).join('|');
  /** The plugins mounted by the PREVIOUS run, so a vanished one is unmounted. */
  const live = useRef<Set<string>>(new Set());

  useEffect(() => {
    const enabledSet = new Set(enabled ? enabled.split('|') : []);
    // Read through the closure the effect was created in: the rows that belong
    // to this signature, not whatever the next render holds.
    const byPlugin = new Map<string, ContentScriptRegistration[]>();
    for (const row of rows) {
      if (!enabledSet.has(row.pluginId)) continue;
      const list = byPlugin.get(row.pluginId) ?? [];
      list.push(row.registration);
      byPlugin.set(row.pluginId, list);
    }

    // A plugin whose registrations all left — or that the registry no longer
    // reports as enabled — is the one that needs taking down.
    for (const pluginId of live.current) {
      if (!byPlugin.has(pluginId)) void unmountContentScripts(pluginId);
    }
    live.current = new Set(byPlugin.keys());

    void (async () => {
      for (const [pluginId, registrations] of byPlugin) {
        const failures = await mountContentScripts(pluginId, registrations, { target: () => document.body });
        for (const failure of failures) {
          console.error(`[plugins] ${failure.pluginId}: content script failed — ${failure.reason}`);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled]);

  // Window teardown: nothing else runs a disposer on an unload, and a script
  // holding listeners past it leaks them into whatever replaces the document.
  useEffect(() => {
    const onUnload = () => void unmountAllContentScripts();
    window.addEventListener('pagehide', onUnload);
    return () => window.removeEventListener('pagehide', onUnload);
  }, []);
}
