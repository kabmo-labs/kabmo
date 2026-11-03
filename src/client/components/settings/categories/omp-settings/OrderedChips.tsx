/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Ordered multi-select for a row whose value is an ARRAY of schema options
 * (first-match-ordered lists such as `tools.approval`).
 *
 * Chips with ←/→ and an add menu, rather than a plain multi-select: the ORDER
 * is the meaning for these keys, and a `<select multiple>` cannot express it.
 * Every mutation commits immediately — there is nothing to blur — so the
 * parent's saving state is the only guard, and the add menu closes on pick.
 */

import { useState } from 'preact/hooks';
import { Plus, X } from 'lucide-preact';
import type { SchemaOption } from '@/shared/lib/omp/config/schema-types';

interface OrderedChipsProps {
  options: SchemaOption[];
  value: unknown;
  saving: boolean;
  onCommit: (next: string[]) => void;
}

export function OrderedChips({ options, value, saving, onCommit }: OrderedChipsProps) {
  const [open, setOpen] = useState(false);
  const current = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  const remaining = options.filter((option) => !current.includes(option.value));
  // Four aria-labels and the chip text read the same option, so the lookup is
  // named once rather than repeated.
  const labelOf = (optionValue: string) => options.find((o) => o.value === optionValue)?.label || optionValue;

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onCommit(next);
  };

  return (
    <div className="flex max-w-72 flex-wrap items-center justify-end gap-1.5">
      {current.map((chip, index) => (
        <span
          key={chip}
          className="inline-flex items-center gap-1 rounded-md border border-ink/15 bg-ink/[0.03] px-2 py-0.5 text-[10px] text-ink"
        >
          {index > 0 && (
            <button
              type="button"
              aria-label={`Move ${labelOf(chip)} earlier`}
              onClick={() => move(index, -1)}
              disabled={saving}
              className="text-ink/40 hover:text-ink cursor-pointer disabled:opacity-40"
            >
              ←
            </button>
          )}
          {labelOf(chip)}
          {index < current.length - 1 && (
            <button
              type="button"
              aria-label={`Move ${labelOf(chip)} later`}
              onClick={() => move(index, 1)}
              disabled={saving}
              className="text-ink/40 hover:text-ink cursor-pointer disabled:opacity-40"
            >
              →
            </button>
          )}
          <button
            type="button"
            aria-label={`Remove ${labelOf(chip)}`}
            onClick={() => onCommit(current.filter((entry) => entry !== chip))}
            disabled={saving}
            className="text-ink/40 hover:text-error cursor-pointer disabled:opacity-40"
          >
            <X size={10} />
          </button>
        </span>
      ))}

      {current.length === 0 && <span className="text-[10px] text-ink/40">nothing selected</span>}

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((isOpen) => !isOpen)}
          disabled={saving || remaining.length === 0}
          aria-expanded={open}
          aria-label="Add an option"
          className="flex items-center gap-0.5 rounded-md border border-ink/15 px-2 py-0.5 text-[10px] text-ink/70 hover:text-ink hover:bg-ink/5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={10} /> add
        </button>
        {open && remaining.length > 0 && (
          <div className="absolute right-0 top-full z-20 mt-1 max-h-44 w-48 overflow-auto rounded-md border border-ink/15 bg-paper p-1 shadow-lg">
            {remaining.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onCommit([...current, option.value]);
                  setOpen(false);
                }}
                className="block w-full rounded px-2 py-1 text-left text-[11px] text-ink/80 hover:bg-ink/5 cursor-pointer"
              >
                {option.label || option.value}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
