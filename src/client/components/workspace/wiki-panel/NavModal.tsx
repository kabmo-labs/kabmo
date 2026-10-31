/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The wiki's navigation on the phone: the floating outline-style button in the
 * page, and the page list as a modal.
 *
 * This is the same pattern the phone's markdown editor already uses for its
 * outline (`MobileOutlineButton`): a tap-sized round button outlined rather
 * than filled, floating over the document it belongs to, with the list in the
 * shared `Modal` shell. The desktop panel keeps its nav column and its
 * drill-down when the column is narrow; `WikiPanel` decides which one renders
 * from the `layout` it was handed, never from a container query.
 *
 * Selecting a page closes the modal, because the point of opening it was to
 * reach that page.
 */

import { useEffect } from 'preact/hooks';
import { ListTree } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import { WikiNav } from '@/client/components/workspace/wiki-panel/Nav';
import type { WikiNavSection } from '@/shared/types/wiki';

interface WikiNavTriggerProps {
  open: boolean;
  onClick: () => void;
}

export function WikiNavTrigger({ open, onClick }: WikiNavTriggerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Browse wiki pages"
      aria-label="Browse wiki pages"
      aria-expanded={open}
      className="absolute bottom-3 right-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-ink/20 bg-paper text-ink/60 shadow-sm transition-all hover:bg-ink/5 hover:text-ink active:scale-95"
    >
      <ListTree size={16} />
    </button>
  );
}

interface WikiNavModalProps {
  open: boolean;
  sections: readonly WikiNavSection[];
  selected: string | null;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function WikiNavModal({ open, sections, selected, onSelect, onClose }: WikiNavModalProps) {
  // A dialog this small is dismissed with Escape in every other surface; the
  // shared `Modal` shell does not bind it, so the owner of the open flag does.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Modal
      onClose={onClose}
      maxWidthClass="max-w-sm"
      zClass="z-[70]"
      ariaLabel="Wiki pages"
      header={
        <div className="flex min-w-0 items-center gap-2">
          <ListTree size={15} className="flex-shrink-0 text-ink/50" />
          <span className="text-sm font-medium">Wiki pages</span>
        </div>
      }
    >
      <div className="flex h-[60vh] min-h-0 flex-col">
        <WikiNav
          sections={sections}
          selected={selected}
          onSelect={(path) => {
            onSelect(path);
            onClose();
          }}
        />
      </div>
    </Modal>
  );
}