/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Schema-driven value editor for one native omp setting key.
 *
 * Renders the control matching the schema entry's type:
 *  - boolean → inline toggle
 *  - enum → select (submenu options or raw values)
 *  - string → select for submenu options, password input for credentials,
 *    otherwise a text field
 *  - number → select for submenu options (option value parses to a number,
 *    e.g. retry.maxRetries) or a plain number field
 *  - array → ordered chip editor (first-match-ordered patterns; multi-select
 *    checkboxes for unordered lists); JSON array string accepted when no
 *    submenu choices exist
 *  - record → single-line JSON object editor
 *
 * The initial value is captured once on mount; every control commits on
 * blur/change instead of per keystroke, so the parent's dirty-state diffing
 * against `initialValue` stays stable.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { X } from 'lucide-preact';
import type { SchemaEntry } from '@/shared/lib/omp/config/schema-types';

interface RowEditorProps {
  entryKey: string;
  entry: SchemaEntry;
  value: unknown;
  initialValue: unknown;
  /** Report the local editing state so the parent can defer saving. */
  onChangeDirty: (key: string, dirty: boolean, revert: () => void) => void;
  /** Commit the new value; returns a promise resolving on success. */
  onCommit: (key: string, value: unknown) => Promise<boolean>;
  /** True while a commit/reset for this key is in flight. */
  saving: boolean;
  /** Set when the last commit for this key failed. */
  saveError: boolean;
}

/** Deep equality for JSON-safe values (arrays, records, scalars). */
const valuesEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Number-editor conversion: strip invalid input instead of shipping NaN. */
const toFiniteNumber = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '+') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Parse a JSON array; null when invalid (keeps previous value). */
const parseJsonArray = (raw: string): unknown[] | null => {
  const trimmed = raw.trim();
  if (trimmed === '') return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Parse a JSON record; null when invalid (keeps previous value). */
const parseJsonRecord = (raw: string): Record<string, unknown> | null => {
  const trimmed = raw.trim();
  if (trimmed === '') return {};
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

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
  const [raw, setRaw] = useState<string>(() => {
    if (value === undefined || value === null) return '';
    return Array.isArray(value) || (typeof value === 'object') ? JSON.stringify(value) : String(value);
  });
  // True when a blur should commit (control went dirty then lost focus).
  const dirtyRef = useRef(false);
  const initialRef = useRef<unknown>(initialValue);
  const options = useMemo(() => (Array.isArray(entry.ui.options) ? entry.ui.options : null), [entry.ui.options]);

  useEffect(() => {
    const next = value === undefined || value === null ? '' : Array.isArray(value) || (typeof value === 'object') ? JSON.stringify(value) : String(value);
    setRaw(next);
    dirtyRef.current = false;
  }, [value]);

  const revert = () => {
    const initial = initialRef.current;
    const text = initial === undefined || initial === null ? '' : Array.isArray(initial) || (typeof initial === 'object') ? JSON.stringify(initial) : String(initial);
    setRaw(text);
    dirtyRef.current = false;
    onChangeDirty(entryKey, false, () => {});
  };

  /** Commit a normalized value; optimistic revert keeps the row consistent. */
  const commit = (next: unknown) => {
    const priorRaw = raw;
    setRaw(typeof next === 'string' ? next : JSON.stringify(next));
    dirtyRef.current = false;
    onCommit(entryKey, next)
      .then((ok) => {
        if (ok) onChangeDirty(entryKey, false, () => {});
        else {
          setRaw(priorRaw);
          onChangeDirty(entryKey, true, revert);
        }
      })
      .catch(() => {
        setRaw(priorRaw);
        onChangeDirty(entryKey, true, revert);
      });
  };

  const commitBlur = () => {
    if (!dirtyRef.current) return;
    if (entry.type === 'number') {
      const parsed = toFiniteNumber(raw);
      if (parsed === null || parsed === value) { revert(); return; }
      commit(parsed);
      return;
    }
    if (entry.type === 'string') {
      const next = raw.trim();
      if (next === value) { revert(); return; }
      commit(next);
      return;
    }
    // array / record as JSON text
    if (entry.type === 'array') {
      const parsed = parseJsonArray(raw);
      if (parsed === null || valuesEqual(parsed, value)) { revert(); return; }
      commit(parsed);
      return;
    }
    if (entry.type === 'record') {
      const parsed = parseJsonRecord(raw);
      if (parsed === null || valuesEqual(parsed, value)) { revert(); return; }
      commit(parsed);
    }
  };

  const markDirty = () => {
    const wasDirty = dirtyRef.current;
    dirtyRef.current = true;
    if (!wasDirty) onChangeDirty(entryKey, true, revert);
  };

  if (entry.type === 'boolean') {
    const checked = value === true;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={entry.ui.label}
        onClick={() => {
          onChangeDirty(entryKey, false, () => {});
          commit(!checked);
        }}
        disabled={saving}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer ${checked ? 'bg-ink' : 'bg-ink/15'} ${saving ? 'opacity-50' : ''}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-paper shadow-sm transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
        />
      </button>
    );
  }

  if (entry.type === 'array' && entry.ui.ordered && options) {
    // Ordered chip list — value is an array of option values; reorder + toggle.
    const current = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    const toggle = (optionValue: string) => {
      commit(current.includes(optionValue) ? current.filter((v) => v !== optionValue) : [...current, optionValue]);
    };
    const move = (index: number, delta: number) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      commit(next);
    };
    return (
      <div className="flex flex-wrap items-center gap-1.5 justify-end max-w-72">
        {current.map((chip, index) => {
          const option = options.find((o) => o.value === chip);
          return (
            <span key={chip} className="inline-flex items-center gap-1 rounded-md border border-ink/15 bg-ink/[0.03] px-2 py-0.5 text-[10px] text-ink">
              {index > 0 && (
                <button type="button" aria-label={`${option?.label ?? chip} left`} onClick={() => move(index, -1)} className="text-ink/40 hover:text-ink cursor-pointer" disabled={saving}>←</button>
              )}
              {option?.label ?? chip}
              {index < current.length - 1 && (
                <button type="button" aria-label={`${option?.label ?? chip} right`} onClick={() => move(index, 1)} className="text-ink/40 hover:text-ink cursor-pointer" disabled={saving}>→</button>
              )}
              <button type="button" aria-label={`Remove ${option?.label ?? chip}`} onClick={() => toggle(chip)} className="text-ink/40 hover:text-error cursor-pointer" disabled={saving}>
                <X size={10} />
              </button>
            </span>
          );
        })}
        {current.length === 0 && <span className="text-[10px] text-ink/40">empty</span>}
        <details className="relative">
          <summary className="cursor-pointer rounded-md border border-ink/15 px-2 py-0.5 text-[10px] text-ink/70 hover:text-ink select-none">add…</summary>
          <div className="absolute right-0 top-full z-10 mt-1 max-h-44 w-48 overflow-auto rounded-md border border-ink/15 bg-paper p-1 shadow-lg">
            {options.filter((o) => !current.includes(o.value)).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => toggle(option.value)}
                className="block w-full rounded px-2 py-1 text-left text-[11px] text-ink/80 hover:bg-ink/5"
              >
                {option.label || option.value}
              </button>
            ))}
            {options.every((o) => current.includes(o.value)) && (
              <div className="px-2 py-1 text-[10px] text-ink/40">all selected</div>
            )}
          </div>
        </details>
      </div>
    );
  }

  const choices = options ?? (entry.type === 'enum' && entry.values ? entry.values.map((v) => ({ value: v, label: v, description: '' })) : null);

  if (choices) {
    const current = value === undefined || value === null ? '' : String(value);
    return (
      <div className="flex items-center gap-2 shrink-0">
        <select
          aria-label={entry.ui.label}
          value={current}
          onChange={(e) => {
            const selected = e.currentTarget.value;
            if (entry.type === 'number') {
              const parsed = toFiniteNumber(selected);
              if (parsed === null || parsed === value) return;
              commit(parsed);
            } else {
              if (selected === value) return;
              commit(selected);
            }
          }}
          disabled={saving}
          className={`bg-paper border border-ink/15 rounded-md px-2 py-1 text-ink max-w-56 ${saving ? 'opacity-50' : ''}`}
        >
          {current === '' && (
            <option value="" disabled>select…</option>
          )}
          {choices.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label || option.value}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (entry.type === 'array') {
    return (
      <input
        aria-label={entry.ui.label}
        type="text"
        value={raw}
        onChange={(e) => { setRaw(e.currentTarget.value); markDirty(); }}
        onBlur={commitBlur}
        disabled={saving}
        placeholder='["anthropic","openai"]'
        className={`w-48 bg-paper border border-ink/15 rounded-md px-2 py-1 text-ink text-right font-mono text-[11px] ${saving ? 'opacity-50' : ''}`}
      />
    );
  }

  if (entry.type === 'record') {
    return (
      <input
        aria-label={entry.ui.label}
        type="text"
        value={raw}
        onChange={(e) => { setRaw(e.currentTarget.value); markDirty(); }}
        onBlur={commitBlur}
        disabled={saving}
        placeholder='{"bash":"prompt"}'
        className={`w-48 bg-paper border border-ink/15 rounded-md px-2 py-1 text-ink text-right font-mono text-[11px] ${saving ? 'opacity-50' : ''}`}
      />
    );
  }

  if (entry.type === 'number') {
    return (
      <input
        aria-label={entry.ui.label}
        type="text"
        inputMode="decimal"
        value={raw}
        onChange={(e) => { setRaw(e.currentTarget.value); markDirty(); }}
        onBlur={commitBlur}
        disabled={saving}
        className={`w-28 bg-paper border border-ink/15 rounded-md px-2 py-1 text-ink text-right font-mono text-[11px] ${saving ? 'opacity-50' : ''}`}
      />
    );
  }

  // string without submenu options
  return (
    <input
      aria-label={entry.ui.label}
      type={entry.credential ? 'password' : 'text'}
      value={raw}
      onChange={(e) => { setRaw(e.currentTarget.value); markDirty(); }}
      onBlur={commitBlur}
      disabled={saving}
      className={`w-48 bg-paper border border-ink/15 rounded-md px-2 py-1 text-ink text-right font-mono text-[11px] ${saving ? 'opacity-50' : ''} ${saveError ? 'border-error' : ''}`}
    />
  );
}
