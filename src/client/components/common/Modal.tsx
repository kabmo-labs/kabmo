import type { FormEvent, ReactNode } from 'preact/compat';
import { X } from 'lucide-preact';

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
}: ModalProps) {
  const body = (
    <>
      {children}
      {footer}
    </>
  );

  return (
    <div
      className={`fixed inset-0 bg-ink/40 backdrop-blur-[2px] ${zClass} flex items-center justify-center p-4`}
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(1rem, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(1rem, env(safe-area-inset-right, 0px))',
      }}
      onClick={onClose}
    >
      {/* `role="dialog"` + `aria-modal`: every modal built on this shell (the
          branch rename/delete dialogs, the provider dialogs, the folder
          prompts) is a dialog to assistive tech, and a screen reader cannot
          announce a panel it does not know is one. `GitPanel`'s own hand-rolled
          shells already carry the pair; the shared shell was the one that
          lacked it. */}
      <div
        role="dialog"
        aria-modal="true"
        className={`bg-paper border border-ink/15 rounded-xl shadow-2xl w-full ${maxWidthClass} max-h-full flex flex-col overflow-hidden text-ink`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-ink/10 flex items-center justify-between flex-shrink-0">
          {header}
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
