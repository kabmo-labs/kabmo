/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One row of the session actions menu. The menu's items differ only in icon,
 * label and tone, so the button shape lives here once — a new action cannot
 * drift into a different padding or hover colour.
 */

import type { LucideIcon } from 'lucide-preact';

export interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** Destructive tone: red label and icon, red-tinted hover. */
  danger?: boolean;
}

export function MenuItem({ icon: Icon, label, onClick, danger = false }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors cursor-pointer ${
        danger ? 'hover:bg-error/10 text-error' : 'hover:bg-ink/5'
      }`}
    >
      <Icon size={12} className={danger ? 'text-error' : 'text-ink/60'} />
      <span>{label}</span>
    </button>
  );
}
