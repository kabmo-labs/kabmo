import { useEffect } from 'preact/hooks';
import { useRef } from 'preact/hooks';
import { usePanelRegistry } from '@/client/hooks/workspace/panel-registry';
import { setPluginContext } from '@/client/lib/plugins/context';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { useListSlotRows } from '@/client/hooks/workspace/list-slots';
import type { ContentScriptRegistration } from '@ompchamber/plugin-sdk';
import {
  mountContentScripts,
  unmountAllContentScripts,
  unmountContentScripts,
} from '@/client/lib/plugins/content-scripts';

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

  return null;
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
 * The dependency is a SIGNATURE rather than the row array: a re-read that
 * produces the same rows is the same set of scripts, and re-running for it
 * would churn every generation for nothing.
 *
 * Reported, never thrown: a script that cannot mount is a plugin bug, and it
 * must not take the chamber's boot with it.
 */
function useContentScripts(): void {
  const rows = useListSlotRows<ContentScriptRegistration>('contentScript');
  const signature = rows.map((row) => `${row.pluginId}:${row.registration.id}`).join('|');
  /** The plugins mounted by the PREVIOUS run, so a vanished one is unmounted. */
  const live = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Read through the closure the effect was created in: the rows that belong
    // to this signature, not whatever the next render holds.
    const byPlugin = new Map<string, ContentScriptRegistration[]>();
    for (const row of rows) {
      const list = byPlugin.get(row.pluginId) ?? [];
      list.push(row.registration);
      byPlugin.set(row.pluginId, list);
    }

    // A plugin whose registrations all left is the one that needs taking down.
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
  }, [signature]);

  // Window teardown: nothing else runs a disposer on an unload, and a script
  // holding listeners past it leaks them into whatever replaces the document.
  useEffect(() => {
    const onUnload = () => void unmountAllContentScripts();
    window.addEventListener('pagehide', onUnload);
    return () => window.removeEventListener('pagehide', onUnload);
  }, []);
}
