/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Schema-driven value editor for one native omp setting key.
 *
 * Renders the control matching the schema entry's type:
 *  - boolean → inline switch (commits on click)
 *  - enum → select over the schema's own values
 *  - string → select for submenu options, password input for credentials
 *    (with a reveal), otherwise a text field
 *  - number → text field with a numeric keypad hint
 *  - array → ordered chip editor when the schema ships options, JSON text
 *    otherwise
 *  - record → single-line JSON object editor
 *
 * Text controls commit on blur, Enter or the row's own check button, and
 * Escape abandons the draft. A draft that cannot be parsed for its type says
 * WHY under the field instead of reverting silently — the old editor reverted
 * on a bad number or JSON with no message, which reads as "saving is broken".
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { Check, Eye, EyeOff, X } from 'lucide-preact';
import type { SchemaEntry } from '@/shared/lib/omp/config/schema-types';
import { parseDraft, valueToText } from '@/shared/lib/omp/config/row-value';
import { OrderedChips } from '@/client/components/settings/categories/omp-settings/OrderedChips';

interface RowEditorProps {
  entryKey: string;
  entry: SchemaEntry;
  value: unknown;
  initialValue: unknown;
  /** Report the local editing state so the parent can defer saving. */
  onChangeDirty: (key: string, dirty: boolean) => void;
  /** Commit the new value; resolves with the server's answer. */
  onCommit: (key: string, value: unknown) => Promise<boolean>;
  /** True while a commit/reset for this key is in flight. */
  saving: boolean;
  /** Set when the last commit for this key failed. */
  saveError: boolean;
}

export function RowEditor({
  entryKey,
  entry,
  value,
  initialValue,
  onChangeDirty,
  onCommit,
  saving,
  saveError,
}: RowEditorProps) {
  const [raw, setRaw] = useState(() => valueToText(value));
  const [draftError, setDraftError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  // True when a blur should commit (control went dirty then lost focus).
  const dirtyRef = useRef(false);
  const initialRef = useRef<unknown>(initialValue);
  const options = Array.isArray(entry.ui.options) ? entry.ui.options : null;

  useEffect(() => {
    setRaw(valueToText(value));
    setDraftError(null);
    dirtyRef.current = false;
  }, [value]);

  const revert = () => {
    setRaw(valueToText(initialRef.current));
    setDraftError(null);
    dirtyRef.current = false;
    onChangeDirty(entryKey, false);
  };

  /** Commit a normalized value; a refusal puts the previous text back. */
  const commit = async (next: unknown) => {
    const priorRaw = raw;
    setRaw(valueToText(next));
    setDraftError(null);
    dirtyRef.current = false;
    const ok = await onCommit(entryKey, next);
    if (ok) onChangeDirty(entryKey, false);
    else {
      setRaw(priorRaw);
      dirtyRef.current = true;
      onChangeDirty(entryKey, true);
    }
  };

  /** Commit the text draft, or name why it cannot be committed. */
  const commitDraft = () => {
    if (!dirtyRef.current) return;
    const parsed = parseDraft(entry.type, raw);
    if (!parsed.ok) {
      setDraftError(parsed.error);
      return;
    }
    if (JSON.stringify(parsed.value) === JSON.stringify(value)) {
      setDraftError(null);
      dirtyRef.current = false;
      onChangeDirty(entryKey, false);
      return;
    }
    void commit(parsed.value);
  };

  const markDirty = () => {
    const wasDirty = dirtyRef.current;
    dirtyRef.current = true;
    setDraftError(null);
    if (!wasDirty) onChangeDirty(entryKey, true);
  };

  if (entry.type === 'boolean') {
    const checked = value === true;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={entry.ui.label}
        onClick={() => void commit(!checked)}
        disabled={saving}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer disabled:cursor-progress ${
          checked ? 'bg-ink' : 'bg-ink/15'
        } ${saving ? 'opacity-50' : ''}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-paper shadow-sm transition-all ${
            checked ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </button>
    );
  }

  if (entry.type === 'array' && entry.ui.ordered && options) {
    return (
      <OrderedChips
        options={options}
        value={value}
        saving={saving}
        onCommit={(next) => void commit(next)}
      />
    );
  }

  const choices = options
    ?? (entry.type === 'enum' && entry.values
      ? entry.values.map((optionValue) => ({ value: optionValue, label: optionValue, description: '' }))
      : null);

  if (choices) {
    const current = value === undefined || value === null ? '' : String(value);
    return (
      <div className="flex shrink-0 items-center gap-2">
        <select
          aria-label={entry.ui.label}
          value={current}
          onChange={(event) => {
            const selected = event.currentTarget.value;
            if (selected === current) return;
            if (entry.type === 'number') {
              const parsed = Number(selected);
              if (!Number.isFinite(parsed)) return;
              void commit(parsed);
            } else {
              void commit(selected);
            }
          }}
          disabled={saving}
          className={`max-w-56 rounded-md border border-ink/15 bg-paper px-2 py-1 text-ink cursor-pointer disabled:cursor-progress ${
            saving ? 'opacity-50' : ''
          }`}
        >
          {current === '' && <option value="" disabled>select…</option>}
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label || choice.value}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const isText = entry.type === 'string' || entry.type === 'number'
    || entry.type === 'array' || entry.type === 'record';
  const placeholder = entry.type === 'array'
    ? '["anthropic","openai"]'
    : entry.type === 'record'
      ? '{"bash":"prompt"}'
      : entry.type === 'number'
        ? 'unset'
        : entry.credential
          ? 'not set'
          : 'unset';

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <input
          aria-label={entry.ui.label}
          aria-invalid={draftError ? true : undefined}
          type={entry.credential && !revealed ? 'password' : 'text'}
          inputMode={entry.type === 'number' ? 'decimal' : undefined}
          value={raw}
          onChange={(event) => {
            setRaw(event.currentTarget.value);
            markDirty();
          }}
          onBlur={() => {
            if (isText) commitDraft();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitDraft();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              revert();
            }
          }}
          disabled={saving}
          spellcheck={false}
          placeholder={placeholder}
          className={`bg-paper border rounded-md px-2 py-1 text-ink text-right text-[11px] ${
            entry.type === 'string' && !entry.credential ? '' : 'font-mono'
          } ${entry.type === 'number' ? 'w-28' : 'w-48'} ${
            draftError || saveError ? 'border-error' : 'border-ink/15'
          } ${saving ? 'opacity-50 cursor-progress' : ''} focus:outline-none focus:border-ink/50`}
        />
        {entry.credential && (
          <button
            type="button"
            aria-label={revealed ? `Hide ${entry.ui.label}` : `Show ${entry.ui.label}`}
            title={revealed ? 'Hide the value' : 'Show the value'}
            onClick={() => setRevealed((isRevealed) => !isRevealed)}
            className="rounded p-1 text-ink/35 hover:text-ink hover:bg-ink/5 cursor-pointer"
          >
            {revealed ? <EyeOff size={11} /> : <Eye size={11} />}
          </button>
        )}
        {isText && dirtyRef.current && (
          <button
            type="button"
            aria-label={`Save ${entry.ui.label}`}
            title="Save (Enter)"
            onClick={commitDraft}
            disabled={saving}
            className="rounded p-1 text-ink/50 hover:text-ink hover:bg-ink/5 cursor-pointer disabled:opacity-40"
          >
            <Check size={11} />
          </button>
        )}
        {isText && draftError && (
          <button
            type="button"
            aria-label={`Discard the change to ${entry.ui.label}`}
            title="Discard (Escape)"
            onClick={revert}
            className="rounded p-1 text-error/70 hover:text-error hover:bg-error/5 cursor-pointer"
          >
            <X size={11} />
          </button>
        )}
      </div>
      {draftError && (
        <span className="max-w-56 text-right text-[10px] leading-snug text-error">{draftError}</span>
      )}
    </div>
  );
}
