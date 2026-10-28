/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The desktop layout's settings modal: whether it is open, which category it
 * opens on, and whether a provider dialog follows.
 *
 * A hook because two different triggers drive it — the sidebar footer's button
 * and the `omp:open-settings` window event (dispatched by the model dropdown,
 * the phone's footer and any plugin) — and the event carries the category it
 * wants. Stated once, the two paths cannot open the same modal on different
 * screens.
 */

import { useState } from 'preact/hooks';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import type { SettingsCategoryId } from '@/shared/types';

export interface SettingsModalState {
  isOpen: boolean;
  category: SettingsCategoryId;
  /** The "add provider" dialog opens on top of the modal's Providers screen. */
  autoOpenAddProvider: boolean;
  open: (category?: SettingsCategoryId, autoOpenAdd?: boolean) => void;
  close: () => void;
}

export function useSettingsModal(): SettingsModalState {
  const [isOpen, setOpen] = useState(false);
  const [category, setCategory] = useState<SettingsCategoryId>('appearance');
  const [autoOpenAddProvider, setAutoOpenAddProvider] = useState(false);

  const open = (next?: SettingsCategoryId, autoOpenAdd = false) => {
    setCategory(next ?? 'appearance');
    setAutoOpenAddProvider(autoOpenAdd);
    setOpen(true);
  };

  useKabmoEvent('omp:open-settings', (event) => {
    const detail = (event as CustomEvent<{ category?: SettingsCategoryId; autoOpenAdd?: boolean }>).detail;
    open(detail?.category, Boolean(detail?.autoOpenAdd));
  });

  return {
    isOpen,
    category,
    autoOpenAddProvider,
    open,
    close: () => {
      setOpen(false);
      setAutoOpenAddProvider(false);
    },
  };
}
