import { useState } from 'preact/hooks';
import { AlertCircle, GitBranch, Plus, Trash2 } from 'lucide-preact';
import type { PanelPluginSource } from '@/shared/types';
import { RefreshButton } from '@/client/components/common/header-button';
import {
  KABMO_PLUGIN_REPO_PREFIX,
  normalisePluginSpec,
  pluginRepoNameError,
} from '@/shared/lib/panels/plugin-repo';

interface RegistriesProps {
  registries: PanelPluginSource[];
  busy: string | null;
  onRegister: (repo: string) => Promise<boolean>;
  onRemove: (repo: string) => Promise<boolean>;
  onRefresh: (repo: string) => Promise<boolean>;
}

/**
 * The GitHub repositories this marketplace publishes from.
 *
 * A REGISTRY here is not the marketplace itself: it is another repository whose
 * plugins this one lists. Registering one writes a `registries` entry into
 * `marketplace.json`, which is why the pane says so — a user who expects a clone
 * or an install to happen would be surprised that the write is a pointer.
 *
 * The naming rule is stated where the field is, in the same sentence that names
 * it, because it is the one thing a user can get wrong before anything reaches
 * GitHub: the repository is `kabmo-plugins-<plugin>`, the plugin it publishes is
 * named whatever its manifest says. A registration whose read failed keeps its
 * row with the reason — dropping it would delete a source because GitHub was
 * briefly unreachable.
 */
export function PluginRegistries({ registries, busy, onRegister, onRemove, onRefresh }: RegistriesProps) {
  const [repo, setRepo] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const isBusy = busy !== null;

  const submit = async (event: Event) => {
    event.preventDefault();
    const raw = repo.trim();
    if (!raw) return;
    const url = normalisePluginSpec(raw);
    if (!url) {
      setLocalError('Expected owner/repo or a GitHub URL.');
      return;
    }
    const repoError = pluginRepoNameError(url);
    if (repoError) {
      setLocalError(repoError);
      return;
    }
    setLocalError(null);
    if (await onRegister(url)) setRepo('');
  };

  return (
    <section className="space-y-2">
      <header className="flex items-center gap-2">
        <GitBranch size={14} className="text-ink/50 flex-shrink-0" />
        <h3 className="text-sm font-medium text-ink">Plugin repositories</h3>
        <span className="ml-auto text-[11px] text-ink/50">
          {registries.length === 0 ? '' : `${registries.length} registered`}
        </span>
      </header>

      <p className="text-[11px] text-ink/55 leading-relaxed">
        A GitHub repository whose plugins appear above without being vendored into this marketplace.
        Its repository name must start with <span className="font-mono">{KABMO_PLUGIN_REPO_PREFIX}</span>;
        the plugin's own name does not need the prefix. Registering writes a{' '}
        <span className="font-mono">registries</span> entry to{' '}
        <span className="font-mono">marketplace.json</span>.
      </p>

      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          type="text"
          value={repo}
          onInput={(event) => {
            setRepo(event.currentTarget.value);
            setLocalError(null);
          }}
          placeholder="owner/kabmo-plugins-name"
          spellcheck={false}
          disabled={isBusy}
          className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-ink/15 bg-paper focus:outline-none focus:border-ink/40 text-xs font-mono text-ink placeholder-ink/40 transition-colors disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isBusy || !repo.trim()}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-ink/20 text-xs text-ink/70 hover:text-ink hover:border-ink/40 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={14} /> Register
        </button>
      </form>

      {localError ? <p className="text-[11px] text-error">{localError}</p> : null}

      {registries.length > 0 ? (
        <div className="rounded-lg border border-ink/10 divide-y divide-ink/5">
          {registries.map((entry) => {
            const updating = busy === `refresh_registry:${entry.repo}`;
            return (
              <div key={entry.repo} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-ink truncate">{entry.name}</span>
                    <span className="text-[10px] font-mono text-ink/45 truncate">{entry.repo}</span>
                  </div>
                  <p className="text-[10px] text-ink/45">
                    {entry.error ? (
                      <span className="inline-flex items-center gap-1 text-error">
                        <AlertCircle size={11} className="flex-shrink-0" />
                        {entry.error}
                      </span>
                    ) : (
                      <>
                        {entry.pluginCount} plugin{entry.pluginCount === 1 ? '' : 's'} ·{' '}
                        {entry.fetchedAt ? `read ${formatDate(entry.fetchedAt)}` : 'not read yet'}
                      </>
                    )}
                  </p>
                  {entry.warning ? <p className="text-[10px] text-ink/50 leading-snug">{entry.warning}</p> : null}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <RefreshButton
                    label="Re-read this repository"
                    disabled={isBusy}
                    busy={updating}
                    onClick={() => void onRefresh(entry.repo)}
                  />
                  {confirming === entry.repo ? (
                    <>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          void onRemove(entry.repo);
                          setConfirming(null);
                        }}
                        className="px-2 py-1 rounded-lg border border-error text-error text-[11px] font-medium hover:bg-error/5 transition-colors cursor-pointer disabled:opacity-40"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="px-1.5 py-1 rounded-lg text-[11px] text-ink/60 hover:text-ink cursor-pointer"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setConfirming(entry.repo)}
                      title="Remove this repository from marketplace.json (installed plugins stay)"
                      aria-label={`Remove ${entry.repo}`}
                      className="flex-shrink-0 rounded-md border border-ink/15 bg-paper p-1.5 text-ink/80 transition-colors hover:bg-ink/5 hover:border-error hover:text-error disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleDateString();
}
