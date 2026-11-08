import { useId, useRef } from 'preact/hooks';
import type { FormEvent, ReactNode } from 'preact/compat';
import { X } from 'lucide-preact';
import { useDialogBehaviour } from '@/client/hooks/ui/dialog-behaviour';
import { safeAreaPadding } from '@/shared/lib/ui/safe-area';

export interface ModalProps {
  /** Backdrop click / close-button handler. */
  onClose: () => void;
  /** Header content rendered left of the close button. */
  header: ReactNode;
  /** Body content. */
  children: ReactNode;
  /** Optional footer row, rendered after the body. */
  footer?: ReactNode;
  /**
   * When set, the body + footer are wrapped in a `<form>` with this onSubmit and
   * className — preserving modals whose whole content is one form.
   */
  form?: { onSubmit: (event: FormEvent) => void; className: string };
  /** Panel width class. Default `max-w-md`. */
  maxWidthClass?: string;
  /** Backdrop z-index class. Default `z-[60]`. */
  zClass?: string;
  /**
   * Accessible name for the dialog. The header is ordinary content, so without
   * this the `role="dialog"` announces itself anonymously to a screen reader.
   * When absent the header's own text names it through `aria-labelledby`.
   */
  ariaLabel?: string;
}

/**
 * Centered modal shell: dimmed backdrop, bordered panel, standard header with
 * close button, and an optional footer. Body/footer stay caller-owned so each
 * modal keeps its exact DOM order, classes and text.
 */
export function Modal({
  onClose,
  header,
  children,
  footer,
  form,
  maxWidthClass = 'max-w-md',
  zClass = 'z-[60]',
  ariaLabel,
}: ModalProps) {
  // Focus, Escape and the Tab wrap come from ONE hook, so every dialog built on
  // this shell behaves the same and a later shell cannot forget the keyboard.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const headerId = useId();
  useDialogBehaviour(panelRef, { open: true, onClose });

  const body = (
    <>
      {children}
      {footer}
    </>
  );

  return (
    <div
      className={`fixed inset-0 modal-scrim backdrop-blur-[2px] ${zClass} flex items-center justify-center p-4`}
      style={safeAreaPadding(1)}
      onClick={onClose}
    >
      {/* `role="dialog"` + `aria-modal`: every modal built on this shell (the
          branch rename/delete dialogs, the provider dialogs, the folder
          prompts) is a dialog to assistive tech, and a screen reader cannot
          announce a panel it does not know is one. `GitPanel`'s own hand-rolled
          shells already carry the pair; the shared shell was the one that
          lacked it. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : headerId}
        tabIndex={-1}
        className={`glass-overlay bg-paper border border-ink/15 rounded-xl shadow-2xl w-full ${maxWidthClass} max-h-full flex flex-col overflow-hidden text-ink`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-ink/10 flex items-center justify-between flex-shrink-0">
          <div id={headerId} className="min-w-0">
            {header}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {form ? (
          // The body scrolls, not the panel: a long form (the add-provider
          // dialog is 832px of fields) is taller than a phone viewport, and
          // without a bounded, scrollable body its footer sat below the screen
          // with no way to reach it — the dialog could not be submitted.
          <form onSubmit={form.onSubmit} className={`${form.className} min-h-0 overflow-y-auto scrollbar-overlay-container`}>
            {body}
          </form>
        ) : (
          <div className="min-h-0 overflow-y-auto scrollbar-overlay-container">{body}</div>
        )}
      </div>
    </div>
  );
}
