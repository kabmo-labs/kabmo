import { createPortal } from 'preact/compat';
import { Heart, X } from 'lucide-preact';
import packageJson from '@/../package.json';
import type { UseUpdatesResult } from '@/client/hooks/ui/updates';
import { SocialLinks } from '@/client/components/layout/session-sidebar/about-modal/SocialLinks';
import { UpdateSection } from '@/client/components/layout/session-sidebar/about-modal/UpdateSection';
import { useChamberEvent } from '@/client/hooks/ui/window-event';
import { UPDATE_POPUP_OPEN_EVENT } from '@/shared/lib/updates/popup-state';

export interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  updates: UseUpdatesResult;
  onToast?: (message: string, type?: 'success' | 'error') => void;
}

export function AboutModal({ isOpen, onClose, updates, onToast }: AboutModalProps) {
  // "What's new" opens the popup, which draws at a higher layer: leaving this
  // dialog mounted would stack two modals over the same subject, and its
  // backdrop would swallow the popup's clicks.
  useChamberEvent(UPDATE_POPUP_OPEN_EVENT, () => {
    if (isOpen) onClose();
  });

  if (!isOpen) return null;

  // Rendered through a portal, for the reason the update popup is: this dialog
  // is mounted inside whichever sidebar is on screen, and that sidebar is not
  // always laid out — the phone's drawer hides its whole screen with
  // `display: none`, and the desktop panel collapses to `width: 0` with
  // `overflow: hidden`. A `position: fixed` subtree under either one is clipped
  // or has no box at all. That mattered the moment the update popup started
  // handing its run over to this dialog: it opens over the chat, with the drawer
  // closed, and was invisible.
  return createPortal(
    <div
      className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative bg-paper border border-ink/15 rounded-2xl shadow-2xl w-full max-w-[340px] p-6 text-center text-ink select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-ink/40 hover:text-ink transition-colors p-1 rounded-md"
          aria-label="Close"
        >
          <X size={18} className="stroke-[2.5]" />
        </button>

        {/* OMP Chamber Brand Logo */}
        <div className="flex justify-center pt-2 pb-1">
          <img src="/icon.svg" alt="Kabmo" width={96} height={96} draggable={false} />
        </div>

        {/* Title */}
        <h2 className="text-xl font-bold tracking-tight mt-3 flex items-center justify-center">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-600 to-amber-500 font-extrabold text-2xl tracking-tighter">OMP</span>
          <span className="text-ink text-2xl font-bold ml-[1px]">Chamber</span>
        </h2>

        {/* App & Agent Versions */}
        <div className="text-xs text-ink/60 space-y-1 mt-1.5 font-mono">
          <p>Kabmo v{packageJson.version}</p>
          <p>Oh-My-Pi {updates.info?.omp.current ?? '…'}</p>
        </div>

        <UpdateSection updates={updates} onToast={onToast} />

        <SocialLinks />

        {/* Footer */}
        <p className="text-[11px] text-ink/50 font-normal mt-8 flex items-center justify-center gap-1.5">
          <Heart size={12} className="fill-current text-error shrink-0" aria-hidden="true" />
          Made with love for the community
        </p>
      </div>
    </div>,
    document.body,
  );
}
