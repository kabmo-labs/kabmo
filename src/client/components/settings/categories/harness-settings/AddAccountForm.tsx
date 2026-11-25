/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The add-account row: a label, the action, and the one sentence that says
 * where the home and the login live. Split from the account list so the panel
 * stays inside the file ceiling; the label state still belongs to the panel,
 * because a completed add has to clear it.
 */

import { Loader2, Plus } from 'lucide-preact';

export interface AddAccountFormProps {
  harness: string;
  label: string;
  busy: boolean;
  onLabel: (value: string) => void;
  onAdd: () => void;
}

export function AddAccountForm({ harness, label, busy, onLabel, onAdd }: AddAccountFormProps) {
  const inputId = `account-label-${harness}`;
  return (
    <div className="rounded-lg border border-dashed border-ink/15 p-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={inputId} className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Add account</span>
          <input
            id={inputId}
            type="text"
            value={label}
            maxLength={80}
            placeholder="Work"
            onInput={(event) => onLabel(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onAdd();
            }}
            className="w-full rounded-md border border-ink/20 bg-paper px-2 py-1.5 text-[11px] text-ink outline-none transition-colors placeholder:text-muted focus:border-ink/50"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={onAdd}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-ink/20 px-2 py-1.5 text-[11px] text-ink/75 transition-colors hover:border-ink/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          Add account
        </button>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
        Creates a private home under Kabmo's data directory. The login itself stays in the agent's own credential store.
      </p>
    </div>
  );
}
