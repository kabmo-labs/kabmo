import { useEffect, useRef, useState } from 'preact/hooks';
import { PluginIdProvider } from '@kabmo-labs/kabmo-ui';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { PluginRenderBoundary } from '@/client/components/common/plugin-render-boundary';
import { requestOpenPanel } from '@/shared/lib/workspace/panel-open';
import {
  MOBILE_HEADER_ENTRY_MAX_PX,
  type HeaderEntry,
} from '@/client/components/common/header-panel-buttons/entries';

export { MOBILE_HEADER_ACTION_PX, useHeaderEntries, type HeaderEntry } from '@/client/components/common/header-panel-buttons/entries';

/**
 * The navbar entries a plugin's `header` panel contributes — on BOTH layouts.
 *
 * Two components, and the split is the contract: the TRIGGER is whatever the
 * entry should read (`10tps ⛁10GB`, an icon, a word), and the DROPDOWN is what
 * opening it shows. A registration with no dropdown is a plain readout — the
 * host then renders it as inert text rather than as a button, so a plugin cannot
 * promise an interaction it does not have.
 *
 * The phone renders these too, in the same slot of the same order as the
 * desktop: a plugin's readout is not a desktop-only fact, and a phone that
 * dropped it left the user with a navbar whose controls moved when they
 * switched layouts. `layout` only decides where the dropdown opens — anchored
 * under its trigger on the desktop, pinned to the viewport on a phone, which
 * has no room for a 320px panel hanging off a control near the right edge.
 *
 * Exactly ONE dropdown is open at a time, across every plugin. Two open entries
 * would overlap (each is anchored to its own trigger, but the navbar is a single
 * row) and the second would cover the first, so the open one is held here as one
 * id rather than as a flag per entry.
 */
export function HeaderPanelButtons({
  layout = 'desktop',
  entries,
}: {
  layout?: 'desktop' | 'mobile';
  /**
   * What stands in the row, already resolved.
   *
   * The header resolves the split ONCE (`useHeaderEntries`) because the `⋯`
   * menu draws the other half of the same answer — resolving here as well would
   * be two media queries and two registry reads deciding one row.
   */
  entries: HeaderEntry[];
}) {
  const inline = entries;
  const { sessionId } = useSessionStateContext();
  const [openKey, setOpenKey] = useState<string | null>(null);

  // A plugin that is uninstalled or switched off while its dropdown is open
  // would leave an empty box on screen; closing is the honest answer.
  useEffect(() => {
    if (openKey && !inline.some((entry) => entry.pluginId === openKey)) setOpenKey(null);
  }, [openKey, inline]);

  // An entry the row could not hold is NOT lost: it is a row of the `⋯` menu,
  // which `HeaderControls` draws from the same resolver. This component draws
  // only what stands in the row, so nothing here reserves space for a control
  // that moved.
  if (inline.length === 0) return null;

  return (
    <div className="flex items-center space-x-1">
      {inline.map((entry) => (
        <HeaderPanelEntry
          key={entry.pluginId}
          entry={entry}
          layout={layout}
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
  layout: 'desktop' | 'mobile';
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
function HeaderPanelEntry(props: HeaderPanelEntryProps) {
  // Every plugin-owned render sits inside a boundary, and the navbar is where
  // it matters most: this component is drawn by the app's ROOT diff, so a throw
  // from the plugin's trigger does not merely blank one control — it leaves the
  // root's vnode bookkeeping half-written and the next render appends a SECOND
  // app tree (measured: two identical navbars until a reload). The boundary
  // takes the throw, the row keeps its other controls, and the chip names the
  // plugin and the reason.
  return (
    <PluginRenderBoundary pluginId={props.entry.pluginId} surface="its navbar entry">
      <HeaderEntryControl {...props} />
    </PluginRenderBoundary>
  );
}

function HeaderEntryControl({ entry, layout, sessionId, open, onToggle, onClose }: HeaderPanelEntryProps) {
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

  const triggerClass = layout === 'mobile'
    ? 'flex items-center gap-1 w-8 h-8 justify-center rounded-lg hover:bg-ink/5 active:bg-ink/10 transition-colors cursor-pointer'
    : 'flex items-center gap-1 px-1.5 py-1 rounded hover:bg-ink/10 transition-colors cursor-pointer';
  /**
   * An ACTION entry's hit area grows with its readout.
   *
   * The fixed 32px square is right for an icon and wrong for two columns of
   * numbers: measured on a 390px phone, the readout inside `w-8 h-8` reported
   * `scrollWidth > clientWidth`, so `1.4G` was clipped by the button that was
   * supposed to present it. The height stays 32px (the phone's tool row) and
   * the width comes from the content, with padding as the only host-imposed
   * number.
   */
  const actionClass = layout === 'mobile'
    ? 'flex items-center gap-1 h-8 px-1.5 justify-center rounded-lg hover:bg-ink/5 active:bg-ink/10 transition-colors cursor-pointer'
    : 'flex items-center gap-1 px-1.5 py-1 rounded hover:bg-ink/10 transition-colors cursor-pointer';

  // An ACTION entry: the readout is a button that asks the layout to show the
  // plugin's own panel. The event carries the panel key and nothing else —
  // where that panel lives (left dock, right column, editor column, a phone
  // drawer) is the layout's answer, because it is the user's placement.
  if (entry.opensPanelKey) {
    const panelKey = entry.opensPanelKey;
    return (
      <button
        type="button"
        onClick={() => requestOpenPanel(panelKey)}
        className={`${actionClass} ${open ? 'text-ink' : 'text-ink/70 hover:text-ink'}`}
        // A plugin owns its trigger's markup, so the row needs a ceiling: a
        // readout that grew without one would push the session title and the
        // controls beside it out of a phone header. The cap is generous for a
        // two-column readout and clips anything past it rather than letting the
        // row overflow.
        style={layout === 'mobile' ? { maxWidth: `${MOBILE_HEADER_ENTRY_MAX_PX}px` } : undefined}
        title={entry.title}
        aria-label={entry.title}
      >
        {trigger}
      </button>
    );
  }

  if (!entry.Dropdown) {
    return (
      <div className="flex items-center px-1.5 text-ink/70" title={entry.title}>
        {trigger}
      </div>
    );
  }

  // The dropdown's geometry is the ONLY thing the layout decides. A phone has
  // no room for a 320px panel hanging off a control near the right edge, so it
  // is pinned to the viewport the way the context popover is; the desktop
  // anchors it under its own trigger.
  const panelClass = layout === 'mobile'
    ? 'fixed z-50 bg-paper border border-ink/15 rounded-xl shadow-lg overflow-auto w-80 max-h-96'
    : 'absolute right-0 top-full mt-1 w-80 max-h-96 overflow-auto bg-paper border border-ink/15 rounded shadow-lg z-50';
  const panelStyle = layout === 'mobile'
    ? {
        top: 'calc(3.5rem + env(safe-area-inset-top, 0px) + 0.375rem)',
        right: 'max(0.75rem, env(safe-area-inset-right, 0px))',
      }
    : undefined;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={onToggle}
        className={`${triggerClass} ${open ? 'text-ink' : 'text-ink/70 hover:text-ink'}`}
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
        <div className={panelClass} style={panelStyle}>
          <PluginIdProvider pluginId={entry.pluginId}>
            <entry.Dropdown sessionId={sessionId} workspacePath={null} />
          </PluginIdProvider>
        </div>
      ) : null}
    </div>
  );
}
