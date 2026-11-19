/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Git → Commit identity.
 *
 * A commit carries a name and an email. Kabmo keeps a small list and one
 * selection; the selection is passed to the git command that creates the
 * commit, so the repository's own config is untouched and a terminal or an
 * agent in the same checkout keeps its identity.
 *
 * "Repository config" is the default and the honest one: with no selection,
 * git answers with whatever `user.name` / `user.email` the repository or the
 * machine already has.
 */

import { useState } from 'preact/hooks';
import { Plus, Trash2 } from 'lucide-preact';
import type { SettingsState } from '@/shared/types';
import { isGitIdentity, type GitIdentity } from '@/shared/lib/git/identity';

interface IdentitySectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

const INPUT_CLASS = 'w-full bg-paper border border-ink/20 rounded-md px-2.5 py-1.5 text-[11px] text-ink placeholder-ink/40 outline-none focus:border-ink/40 transition-colors';

export function IdentitySection({ settings, onUpdate }: IdentitySectionProps) {
  const identities = settings.gitIdentities ?? [];
  const selected = settings.gitCommitIdentity ?? '';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const candidate: GitIdentity = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      email: email.trim(),
    };
    if (!isGitIdentity(candidate)) {
      setError('Enter a name and a valid email address.');
      return;
    }
    onUpdate({ gitIdentities: [...identities, candidate], gitCommitIdentity: candidate.id });
    setName('');
    setEmail('');
    setError(null);
  };

  const remove = (id: string) => {
    onUpdate({
      gitIdentities: identities.filter((entry) => entry.id !== id),
      ...(selected === id ? { gitCommitIdentity: '' } : {}),
    });
  };

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Commit Identity</h4>
        <p className="text-[11px] text-ink/60 mt-0.5">
          The name and email a commit carries. Repository config leaves git's own user.name and user.email in charge.
        </p>
      </div>

      <div className="rounded-lg border border-ink/15 bg-paper divide-y divide-ink/10">
        <label className="flex items-center gap-3 p-3.5 cursor-pointer">
          <input
            type="radio"
            checked={selected === ''}
            onChange={() => onUpdate({ gitCommitIdentity: '' })}
            className="accent-ink"
          />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-ink">Repository config</div>
            <div className="text-[10px] text-ink/50">git's own user.name / user.email</div>
          </div>
        </label>

        {identities.map((identity) => (
          <div key={identity.id} className="flex items-center gap-3 p-3.5">
            <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
              <input
                type="radio"
                checked={selected === identity.id}
                onChange={() => onUpdate({ gitCommitIdentity: identity.id })}
                className="accent-ink"
              />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-ink truncate">{identity.name}</div>
                <div className="text-[10px] text-ink/50 truncate">{identity.email}</div>
              </div>
            </label>
            <button
              type="button"
              onClick={() => remove(identity.id)}
              aria-label={`Remove ${identity.name}`}
              className="p-1.5 rounded text-ink/40 hover:text-error hover:bg-ink/5 transition-colors cursor-pointer"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-ink/15 bg-paper p-3.5 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.currentTarget.value); setError(null); }}
            placeholder="User name"
            className={INPUT_CLASS}
          />
          <input
            type="text"
            value={email}
            onChange={(e) => { setEmail(e.currentTarget.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Email address"
            className={INPUT_CLASS}
          />
        </div>
        {error && <p className="text-[10px] text-error">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] text-ink/50">Applied to commits made from the Source Control panel.</p>
          <button
            type="button"
            onClick={add}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-ink text-canvas text-[10px] font-medium hover:bg-ink/90 transition-colors cursor-pointer"
          >
            <Plus size={11} /> Add identity
          </button>
        </div>
      </div>

      <p className="text-[10px] text-ink/45 leading-relaxed">
        The selected identity is passed to git for each commit. It does not rewrite the repository's config, so a terminal or an agent keeps its own identity.
      </p>
    </section>
  );
}
