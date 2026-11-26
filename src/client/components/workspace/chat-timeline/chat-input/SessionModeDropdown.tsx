/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ACP agent's own session-mode selector.
 *
 * ACP exposes modes as a `mode`-category config option (the older `modes` list
 * is normalized into the same shape server-side). Kabmo's Plan toggle only
 * names one value; an agent that offers `ask`/`code`/`architect` needs the whole
 * list. The control is hidden when there is nothing to choose — null for omp,
 * or a one-value ladder — and `ModeToggles` then keeps the Plan button.
 *
 * The popover mirrors `AccessDropdown`: a chip, a list, a check on the current
 * value, and dismissal on outside press.
 */

import { useRef, useState } from 'preact/hooks';
import { Check, ChevronDown, Layers } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import type { SessionModeState } from '@kabmo-labs/kabmo-harness/session-modes';

export interface SessionModeDropdownProps {
  mode: SessionModeState | null;
  /** A mode command is in flight; the chip reads as pending, not dead. */
  pending: boolean;
  onSelect: (value: string) => void;
  /** Too narrow for labels: the layers glyph alone (see `useComposerNarrow`). */
  iconOnly?: boolean;
}

export function SessionModeDropdown({ mode, pending, onSelect, iconOnly = false }: SessionModeDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false));

  if (!mode || mode.values.length < 2) return null;
  const current = mode.values.find((choice) => choice.value === mode.currentValue);
  // A chat that has not spawned yet has no live selector to ask: the probe names
  // the ladder but not always which value is current, and an empty label read as
  // a broken chip beside a working list.
  const label = current?.name ?? (mode.currentValue || 'Mode');

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Session mode: ${label}`}
        title={`Session mode: ${label}`}
        className="tap-chip flex items-center space-x-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-ink/5 hover:text-ink disabled:cursor-wait disabled:opacity-60"
      >
        <Layers size={12} className="text-ink/60" />
        {!iconOnly && <span className="max-w-[9rem] truncate">{label}</span>}
        <ChevronDown size={11} className={`flex-shrink-0 text-ink/40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Session mode"
          className="glass-popover absolute bottom-full left-0 mb-1 w-44 bg-paper border border-ink/20 rounded-md shadow-lg z-50 py-1 text-xs"
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink/40 font-semibold border-b border-ink/5 mb-1">
            Session Mode
          </div>
          {mode.values.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="option"
              aria-selected={choice.value === mode.currentValue}
              onClick={() => {
                setOpen(false);
                onSelect(choice.value);
              }}
              className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-2 transition-colors hover:bg-ink/5 ${
                choice.value === mode.currentValue ? 'bg-ink/10 font-medium text-ink' : 'text-ink/75'
              }`}
            >
              <span className="truncate">{choice.name}</span>
              {choice.value === mode.currentValue && <Check size={12} className="text-ink shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
