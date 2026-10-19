import { Loader2 } from 'lucide-preact';
import { BUILTIN_PANELS } from '@/client/components/workspace/panels/builtin';

interface BuiltinListProps {
  /** Every panel id switched off — a bare view id, or `plugin:<id>`. */
  disabled: string[];
  /** The action in flight, so a row can show which switch is running. */
  busy: string | null;
  onSetEnabled: (panelId: string, enabled: boolean) => Promise<boolean>;
}

/**
 * The views Kabmo ships, with the same switch an installed plugin gets.
 *
 * They are listed FIRST and separated from the plugins because the two are
 * different kinds of thing: a built-in view is Kabmo's own code and is
 * always present, while a plugin can be installed and removed. What they share
 * is the switch — and sharing it is the point of this section. Enablement is one
 * set of ids (`git` for a view, `plugin:<id>` for a plugin), so a view switched
 * off here leaves the activity bar, the phone's strip and the right-click menu
 * alike, and switching it back on is the same write.
 *
 * There is deliberately NO Remove: a built-in view's code is in the bundle, so
 * "remove" would be a button that either does nothing or hides the truth. This
 * is also what makes a built-in view behave like a plugin that arrived already
 * installed and already enabled — the difference is only that its install
 * cannot be undone.
 */
export function BuiltinList({ disabled, busy, onSetEnabled }: BuiltinListProps) {
  const off = new Set(disabled);

  return (
    <section>
      <header className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-medium text-ink">Built-in</h3>
        <span className="ml-auto text-[11px] text-ink/50">
          {BUILTIN_PANELS.length - BUILTIN_PANELS.filter((panel) => off.has(panel.id)).length} of{' '}
          {BUILTIN_PANELS.length} on
        </span>
      </header>

      <p className="text-[11px] text-ink/50 mb-2">
        The views Kabmo ships. Switch one off to put it away — its code stays in the app, so this is
        reversible at any time and needs no reinstall.
      </p>

      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
        {BUILTIN_PANELS.map((panel) => {
          const enabled = !off.has(panel.id);
          const toggling = busy === `enable:${panel.id}` || busy === `disable:${panel.id}`;
          return (
            <div
              key={panel.id}
              className={`flex items-center gap-2.5 border border-ink/10 rounded-lg px-2.5 py-2 transition-colors ${
                enabled ? 'bg-paper' : 'bg-ink/[0.02]'
              }`}
            >
              <span className={enabled ? 'text-ink/70 flex-shrink-0' : 'text-ink/30 flex-shrink-0'}>
                {panel.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-xs truncate ${enabled ? 'text-ink' : 'text-ink/45'}`} title={panel.title}>
                  {panel.title}
                </span>
                <span className="block text-[10px] font-mono text-ink/40 truncate">{panel.id}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={`${enabled ? 'Disable' : 'Enable'} ${panel.title}`}
                disabled={busy !== null}
                onClick={() => void onSetEnabled(panel.id, !enabled)}
                title={enabled ? 'Switch off — remove its button' : 'Switch on'}
                className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 disabled:opacity-40 ${
                  enabled ? 'bg-ink/70' : 'bg-ink/20'
                }`}
              >
                {toggling ? (
                  <Loader2 size={9} className="absolute inset-0 m-auto animate-spin text-canvas" />
                ) : (
                  <span
                    className={`absolute top-0.5 w-3 h-3 rounded-full bg-canvas transition-all ${
                      enabled ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
