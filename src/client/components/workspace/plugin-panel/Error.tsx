import { AlertTriangle, Loader2 } from 'lucide-preact';

interface PluginErrorProps {
  pluginId: string;
  reason: string;
}

/**
 * Why a plugin panel is not on screen.
 *
 * A plugin that is enabled but has no component right now has three very
 * different causes — its bundle is still importing, it failed to load, or it is
 * not installed — and a blank panel makes all three look like a broken console.
 * The distinction that matters most is TRANSIENT versus PERMANENT: a bundle
 * still importing resolves itself, while a failure will not.
 */
export function PluginError({ pluginId, reason }: PluginErrorProps) {
  const pending = reason.includes('not loaded yet');
  return (
    <div className="h-full w-full flex items-center justify-center px-6 text-center">
      <div className="max-w-sm space-y-2">
        <div className={`flex items-center justify-center gap-2 ${pending ? 'text-ink/50' : 'text-error'}`}>
          {pending ? (
            <Loader2 size={14} className="animate-spin flex-shrink-0" />
          ) : (
            <AlertTriangle size={14} className="flex-shrink-0" />
          )}
          <span className="text-xs font-medium">
            {pending ? 'Loading plugin…' : 'Plugin unavailable'}
          </span>
        </div>
        <p className="text-[11px] font-mono text-ink/45 break-all">{pluginId}</p>
        {!pending ? <p className="text-[11px] text-ink/60">{reason}</p> : null}
      </div>
    </div>
  );
}
