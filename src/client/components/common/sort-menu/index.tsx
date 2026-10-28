/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Sort-options list shared by the desktop toolbar dropdown and the mobile
 * toolbar dropdown. Renders ONLY the header + option rows — each toolbar owns
 * its own absolutely-positioned container (and, on mobile, the Filter section
 * that follows), so the two shells stay exactly as they were while the option
 * list itself has one source of truth.
 */

import { Check } from 'lucide-preact';
import type { SessionSortOption } from '@/shared/types';
import { SORT_LABELS, SORT_OPTIONS } from '@/client/components/common/sort-menu/options';

interface SortMenuProps {
  variant: 'desktop' | 'mobile';
  sortOption: SessionSortOption;
  onSortChange: (opt: SessionSortOption) => void;
}

export function SortMenu({ variant, sortOption, onSortChange }: SortMenuProps) {
  if (variant === 'mobile') {
    return (
      <>
        <div className="px-2 py-1 text-[10px] uppercase font-bold text-ink/40 font-mono">Sort Workspaces</div>
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt}
            type="button"
            onClick={() => onSortChange(opt)}
            className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
              sortOption === opt
                ? 'bg-ink/10 font-semibold text-ink'
                : 'hover:bg-ink/5 text-ink/80'
            }`}
          >
            <span>{opt.replace('_', ' ')}</span>
            {sortOption === opt && <Check size={13} className="text-ink" />}
          </button>
        ))}
      </>
    );
  }

  return (
    <>
      <div className="px-3 py-1 text-[10px] uppercase font-bold text-ink/40 tracking-wider">Sort Workspaces</div>
      {SORT_OPTIONS.map(opt => (
        <div
          key={opt}
          className={`px-3 py-1.5 text-xs cursor-pointer flex items-center justify-between ${sortOption === opt ? 'bg-ink/5 text-ink font-medium' : 'text-ink/70 hover:bg-ink/5 hover:text-ink'}`}
          onClick={() => onSortChange(opt)}
        >
          <span>{SORT_LABELS[opt]}</span>
          {sortOption === opt && <div className="w-1.5 h-1.5 rounded-full bg-ink"></div>}
        </div>
      ))}
    </>
  );
}
