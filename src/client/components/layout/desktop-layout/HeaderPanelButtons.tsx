import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import type { HeaderDropdownProps, HeaderTriggerProps } from '@ompchamber/plugin-sdk/app';
import { usePanelRegistry, usePanelSlots } from '@/client/hooks/workspace/panel-registry';
import { headerDropdownOf, headerTriggerOf } from '@/client/lib/plugins/slots';
import { PluginIdProvider } from '@ompchamber/ui';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';

interface HeaderEntry {
  pluginId: string;
  title: string;
  /** What the navbar entry reads. */
  Trigger: ComponentType<HeaderTriggerProps>;
  /** What opening it shows, when the plugin declared one. */
  Dropdown?: ComponentType<HeaderDropdownProps>;
}

/**
 * The navbar entries a plugin's `header` panel contributes — DESKTOP ONLY.
 *
 * Two components, and the split is the contract: the TRIGGER is whatever the
 * entry should read (`10tps ⛁10GB`, an icon, a word), and the DROPDOWN is what
 * opening it shows. A registration with no dropdown is a plain readout — the
 * host then renders it as inert text rather than as a button, so a plugin cannot
 * promise an interaction it does not have.
 *
 * It is a desktop shape: a phone's navbar has no room for it, and the phone's
 * right-side drawer already carries every view. The navbars are separate
 * components for that reason, and this one is simply not rendered on the mobile
 * layout.
 *
 * Exactly ONE dropdown is open at a time, across every plugin. Two open entries
 * would overlap (each is anchored to its own trigger, but the navbar is a single
 * row) and the second would cover the first, so the open one is held here as one
 * id rather than as a flag per entry.
 */
export function HeaderPanelButtons() {
  const { panels } = usePanelRegistry();
  const { slots } = usePanelSlots();
  const { sessionId } = useSessionStateContext();
  const [openKey, setOpenKey] = useState<string | null>(null);

  const entries: HeaderEntry[] = [];
  for (const panel of panels) {
    const entry = slots.get(panel.pluginId);
    const Trigger = entry ? headerTriggerOf(entry) : undefined;
    // A plugin whose bundle has not loaded yet has no component; it appears
    // once the import settles rather than as an empty entry now.
    if (!Trigger) continue;
    const Dropdown = entry ? headerDropdownOf(entry) : undefined;
    entries.push({
      pluginId: panel.pluginId,
      title: entry?.titles.headerPanel ?? panel.name,
      Trigger,
      ...(Dropdown ? { Dropdown } : {}),
    });
  }

  // A plugin that is uninstalled or switched off while its dropdown is open
  // would leave an empty box on screen; closing is the honest answer.
  useEffect(() => {
    if (openKey && !entries.some((entry) => entry.pluginId === openKey)) setOpenKey(null);
  }, [openKey, entries]);

  if (entries.length === 0) return null;

  return (
    <div className="flex items-center space-x-1">
      {entries.map((entry) => (
        <HeaderPanelEntry
          key={entry.pluginId}
          entry={entry}
          sessionId={sessionId ?? null}
          open={openKey === entry.pluginId}
          onToggle={() => setOpenKey((current) => (current === entry.pluginId ? null : entry.pluginId))}
          onClose={() => setOpenKey(null)}
        />
      ))}
    </div>
  );
}

interface HeaderPanelEntryProps {
  entry: HeaderEntry;
  sessionId: string | null;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}

/**
 * One navbar entry: the plugin's trigger, and its dropdown when it has one.
 *
 * The two cases are deliberately different elements. A plugin WITH a dropdown
 * gets a real `<button>` — keyboard reachable, `aria-expanded`, Escape and
 * outside-click close it. A plugin WITHOUT one gets a plain container: making it
 * a button would advertise an interaction that does not exist, and a readout
 * like `10tps ⛁10GB` is not something a user should be able to "press".
 */
function HeaderPanelEntry({ entry, sessionId, open, onToggle, onClose }: HeaderPanelEntryProps) {
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, onClose);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const trigger = (
    <PluginIdProvider pluginId={entry.pluginId}>
      <entry.Trigger sessionId={sessionId} workspacePath={null} />
    </PluginIdProvider>
  );

  if (!entry.Dropdown) {
    return (
      <div className="flex items-center px-1.5 text-ink/70" title={entry.title}>
        {trigger}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={onToggle}
        className={`flex items-center gap-1 px-1.5 py-1 rounded hover:bg-ink/10 transition-colors cursor-pointer ${
          open ? 'text-ink' : 'text-ink/70 hover:text-ink'
        }`}
        title={entry.title}
        aria-label={`${entry.title} (plugin ${entry.pluginId})`}
        aria-expanded={open}
      >
        {trigger}
      </button>

      {open ? (
        // The plugin's own component, not a summary the host draws: it owns its
        // markup, exactly as it does for a right-panel view. Mounted ONLY while
        // open, so a closed header renders nothing.
        <div className="absolute right-0 top-full mt-1 w-80 max-h-96 overflow-auto bg-paper border border-ink/15 rounded shadow-lg z-50">
          <PluginIdProvider pluginId={entry.pluginId}>
            <entry.Dropdown sessionId={sessionId} workspacePath={null} />
          </PluginIdProvider>
        </div>
      ) : null}
    </div>
  );
}
