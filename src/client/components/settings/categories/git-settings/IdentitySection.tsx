/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Git → Commit identity.
 *
 * The saved identities are a library; the user's GLOBAL git config is the
 * source of truth. Applying one writes `user.name` / `user.email` with
 * `git config --global`, so every repository without a local override commits
 * as that person. "Global config" restores what was there before Kabmo wrote.
 *
 * The previous values and the applied id live in the same config under
 * `kabmo.identity.*`, so the backup survives a restart and cannot be applied to
 * the wrong scope.
 */

import { useEffect, useState } from 'preact/hooks';
import { Plus, Trash2 } from 'lucide-preact';
import type { SettingsState } from '@/shared/types';
import { isGitIdentity, type GitIdentity, type GitIdentityRead } from '@/shared/lib/git/identity';
import { SearchSelect } from '@/client/components/common/search-select';

interface IdentitySectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

const INPUT_CLASS = 'w-full bg-paper border border-ink/20 rounded-md px-2.5 py-1.5 text-[11px] text-ink placeholder-ink/40 outline-none focus:border-ink/40 transition-colors';

export function IdentitySection({ settings, onUpdate }: IdentitySectionProps) {
  const identities = settings.gitIdentities ?? [];
  const [read, setRead] = useState<GitIdentityRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch('/api/settings/git-identity')
      .then(async (response) => {
        const body = await response.json().catch(() => null) as (GitIdentityRead & { error?: string }) | null;
        if (!response.ok || !body) throw new Error(body?.error || `Request failed (HTTP ${response.status})`);
        if (active) setRead({ global: body.global, appliedId: body.appliedId });
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const apply = async (identityId: string) => {
    setBusy(identityId || 'global');
    setError(null);
    try {
      const response = await fetch('/api/settings/git-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityId }),
      });
      const body = await response.json().catch(() => null) as (GitIdentityRead & { error?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error || `Request failed (HTTP ${response.status})`);
      setRead({ global: body.global, appliedId: body.appliedId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

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
    onUpdate({ gitIdentities: [...identities, candidate] });
    setName('');
    setEmail('');
    setError(null);
  };

  const remove = async (id: string) => {
    if (read?.appliedId === id) await apply('');
    onUpdate({ gitIdentities: identities.filter((entry) => entry.id !== id) });
  };

  const appliedId = read?.appliedId ?? '';
  const global = read?.global ?? null;

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Commit Identity</h4>
        <p className="text-[11px] text-ink/60 mt-0.5">
          The name and email a commit carries. Applying an identity writes it to your global git config.
        </p>
      </div>

      <div className="rounded-lg border border-ink/15 bg-paper p-3.5 space-y-2">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-ink/45">Commit as</label>
        <SearchSelect
          ariaLabel="Commit identity"
          value={appliedId}
          onChange={(value) => void apply(value)}
          disabled={loading || busy !== null}
          placeholder="Global config"
          searchable={identities.length > 8}
          options={[
            {
              value: '',
              label: 'Global config',
              hint: "git's own user.name / user.email",
            },
            ...identities.map((identity) => ({
              value: identity.id,
              label: identity.name,
              hint: identity.email,
            })),
          ]}
        />
        <p className="text-[10px] text-ink/50">
          {loading
            ? 'Reading git config…'
            : global
              ? `Current: ${global.name} <${global.email}>`
              : 'No identity configured'}
          {busy ? ' · applying…' : ''}
        </p>
      </div>

      {identities.length > 0 && (
        <details className="rounded-lg border border-ink/15 bg-paper">
          <summary className="px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink/45 cursor-pointer select-none">
            Manage saved identities ({identities.length})
          </summary>
          <div className="divide-y divide-ink/10 border-t border-ink/10 max-h-48 overflow-y-auto">
            {identities.map((identity) => (
              <div key={identity.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-ink truncate">{identity.name}</div>
                  <div className="text-[10px] text-ink/50 truncate">{identity.email}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void remove(identity.id)}
                  aria-label={`Remove ${identity.name}`}
                  className="p-1.5 rounded text-ink/40 hover:text-error hover:bg-ink/5 transition-colors cursor-pointer"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {error && <p className="text-[10px] text-error">{error}</p>}

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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] text-ink/50">Saved identities are a library; pick one above to apply it globally.</p>
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
        Applying writes `user.name` and `user.email` to your global git config. Global config restores what was there before Kabmo wrote.
      </p>
    </section>
  );
}
