/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Add an ACP harness this build does not ship.
 *
 * The transport is already generic: a harness is a command vector plus a label,
 * and the probe/spawn paths read the same registry. This form is the only place
 * a user writes one, so it validates the id (it becomes a settings key and a
 * URL), refuses a built-in collision, and shows the exact command that will be
 * spawned — a harness is local code, and the user should see what runs.
 *
 * Removal is here rather than on the card because a card is also drawn for a
 * built-in harness, and a Remove control on a row that cannot be removed is a
 * button that only ever refuses.
 */

import { useState } from 'preact/hooks';
import { Plus, Trash2 } from 'lucide-preact';
import { SettingsNotice } from '@/client/components/settings/categories/harness-settings/parts';
import type { HarnessSummary } from '@/shared/types/harness';

interface CustomHarnessFormProps {
  harnesses: readonly HarnessSummary[];
  /** Re-read the catalog after a write, so the new row appears everywhere. */
  onChanged: () => void;
}

const EMPTY = { id: '', label: '', command: '', env: '', initial: '' };

export function CustomHarnessForm({ harnesses, onChanged }: CustomHarnessFormProps) {
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const custom = harnesses.filter((entry) => entry.custom);

  const set = (key: keyof typeof EMPTY) => (event: Event) => {
    const value = (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/harness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customHarness: draft }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? `Could not add this harness (HTTP ${response.status})`);
        return;
      }
      setDraft(EMPTY);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add this harness');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/harness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeHarness: id }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? `Could not remove this harness (HTTP ${response.status})`);
        return;
      }
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove this harness');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-ink/10 p-4">
      <header>
        <h3 className="text-sm font-semibold text-ink">Add an ACP harness</h3>
        <p className="mt-0.5 text-[11px] text-ink/50">
          Any agent that speaks the Agent Client Protocol over stdio. Kabmo runs the command you
          type, so only add a program you trust.
        </p>
      </header>

      {error && <SettingsNotice message={error} onDismiss={() => setError(null)} dismissLabel="Dismiss this message" />}

      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-2">
        <label className="text-[11px] text-ink/60">
          id
          <input
            value={draft.id}
            onInput={set('id')}
            placeholder="my-agent"
            required
            pattern="[a-z0-9][a-z0-9-]{0,31}"
            className="mt-1 w-full rounded-md border border-ink/20 bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-ink/50"
          />
        </label>
        <label className="text-[11px] text-ink/60">
          label
          <input
            value={draft.label}
            onInput={set('label')}
            placeholder="My Agent"
            className="mt-1 w-full rounded-md border border-ink/20 bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-ink/50"
          />
        </label>
        <label className="text-[11px] text-ink/60 sm:col-span-2">
          command
          <input
            value={draft.command}
            onInput={set('command')}
            placeholder="npx -y my-agent acp"
            required
            className="mt-1 w-full rounded-md border border-ink/20 bg-paper px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-ink/50"
          />
        </label>
        <label className="text-[11px] text-ink/60 sm:col-span-2">
          env (one KEY=VALUE per line)
          <textarea
            value={draft.env}
            onInput={set('env')}
            rows={2}
            className="mt-1 w-full rounded-md border border-ink/20 bg-paper px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-ink/50"
          />
        </label>
        <label className="text-[11px] text-ink/60">
          initial (optional)
          <input
            value={draft.initial}
            onInput={set('initial')}
            maxLength={2}
            placeholder="M"
            className="mt-1 w-full rounded-md border border-ink/20 bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-ink/50"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-ink/20 px-2.5 py-1.5 text-[11px] text-ink/70 transition-colors hover:border-ink/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={12} /> Add harness
          </button>
        </div>
      </form>

      {custom.length > 0 && (
        <ul className="divide-y divide-ink/10 border-t border-ink/10 pt-2">
          {custom.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate text-xs text-ink">
                {entry.label} <span className="text-ink/40">({entry.id})</span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(entry.id)}
                title={`Remove ${entry.label}`}
                aria-label={`Remove ${entry.label}`}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-ink/20 px-2 py-1 text-[11px] text-ink/60 transition-colors hover:border-ink/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 size={11} /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
