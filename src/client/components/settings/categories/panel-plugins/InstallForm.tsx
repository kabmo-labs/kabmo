import { useState } from 'preact/hooks';
import { Download, Loader2, Trash2 } from 'lucide-preact';

interface InstallFormProps {
  busy: boolean;
  onInstall: (url: string) => Promise<boolean>;
  onClearError: () => void;
}

/**
 * Install a panel plugin from a git URL, GitHub's `owner/repo` shorthand, or the
 * name of a plugin a registered repository offers.
 *
 * The URL form is the whole install grammar for an unregistered plugin — there
 * is no package name, no registry and no version to pick, because a plugin is a
 * repository whose root holds a `kabmo.json` (or a `package.json` with a `kabmo`
 * key). An external GitHub repository must be named `kabmo-plugins-<plugin>`;
 * the PLUGIN keeps its own name, which is why a bare plugin name is installable
 * once its repository is registered.
 *
 * Only its OWN validation is rendered here. A server error belongs to whichever
 * action produced it — install, update, or the auto-update switch — so the pane
 * reports those in one banner above the form rather than in the field that
 * happens to sit nearest.
 */
export function InstallForm({ busy, onInstall, onClearError }: InstallFormProps) {
  const [url, setUrl] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async (event: Event) => {
    event.preventDefault();
    const value = url.trim();
    if (!value) return;
    // Mirrors the server's guard by REJECTING only what can never work: a value
    // with whitespace is neither a URL, a `owner/repo` pair nor a plugin name.
    // Everything else is sent — a bare name is resolved against the registered
    // repositories server-side, and refusing it here would refuse a name the
    // pane is showing.
    if (/\s/.test(value)) {
      setLocalError('Expected a git URL, owner/repo, or a plugin name.');
      return;
    }
    setLocalError(null);
    onClearError();
    const ok = await onInstall(value);
    if (ok) setUrl('');
  };

  const shown = localError;

  return (
    <form onSubmit={submit} className="border border-ink/15 rounded p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Download size={14} className="text-ink/50 flex-shrink-0" />
        <span className="text-xs font-semibold text-ink">Install a plugin</span>
      </div>
      <p className="text-[11px] text-ink/50">
        A git URL or <span className="font-mono">owner/repo</span> of a repository whose{' '}
        <span className="font-mono">package.json</span> carries a <span className="font-mono">kabmo</span> key
        (or a plain directory with a <span className="font-mono">kabmo.json</span>), or the name of a plugin a
        repository above offers. GitHub repositories must start with{' '}
        <span className="font-mono">kabmo-plugins-</span>; the plugin's own name does not. It is cloned, built,
        and registered automatically.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => {
            setUrl(e.currentTarget.value);
            setLocalError(null);
          }}
          placeholder="owner/kabmo-plugins-my-panel, kanban, or https://…"
          disabled={busy}
          className="flex-1 bg-paper border border-ink/15 rounded px-2.5 py-1.5 text-xs font-mono text-ink placeholder-ink/35 focus:outline-none focus:border-ink/40 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-ink/15 hover:bg-ink/5 disabled:opacity-40 disabled:hover:bg-transparent flex-shrink-0"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          {busy ? 'Cloning…' : 'Install'}
        </button>
      </div>
      {shown ? <p className="text-[11px] text-error">{shown}</p> : null}
    </form>
  );
}

interface RemoveButtonProps {
  pluginId: string;
  disabled: boolean;
  onRemove: (pluginId: string) => Promise<boolean>;
}

/**
 * Remove a plugin directory.
 *
 * Confirms first, and names what goes: the directory is deleted from disk, so a
 * mis-click is not undoable from the UI — re-installing is the only way back.
 */
export function RemovePluginButton({ pluginId, disabled, onRemove }: RemoveButtonProps) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={disabled}
        title={`Remove ${pluginId} from disk`}
        aria-label={`Remove ${pluginId}`}
        className="p-1 rounded text-ink/40 hover:text-error hover:bg-error/10 disabled:opacity-40 flex-shrink-0"
      >
        <Trash2 size={13} />
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1 flex-shrink-0">
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
          void onRemove(pluginId);
        }}
        className="px-1.5 py-0.5 text-[10px] rounded bg-error/15 text-error border border-error/30 hover:bg-error/25"
      >
        Delete files
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="px-1.5 py-0.5 text-[10px] rounded border border-ink/15 hover:bg-ink/5"
      >
        Cancel
      </button>
    </span>
  );
}
