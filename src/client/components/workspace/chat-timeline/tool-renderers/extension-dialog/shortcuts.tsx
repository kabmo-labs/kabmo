/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The keyboard shortcuts of omp's blocking dialog, and the per-method chrome.
 *
 * Both are about WHICH dialog is on screen rather than what it draws, so they
 * live here and the dialog component keeps the markup.
 *
 * The shortcuts are a `window` listener, not a keydown on the panel: omp
 * blocks the whole agent on this dialog, and the reader's focus may be in the
 * custom-answer field, in the panel itself, or nowhere — so the dialog
 * answers the key wherever it lands. The one exception is a key pressed
 * INSIDE the custom-answer field: those keys belong to the text the user is
 * typing, not to the dialog.
 */

import { useEffect } from 'preact/hooks';
import { AlertCircle, FileText, HelpCircle, ListFilter, Terminal } from 'lucide-preact';
import type { ComponentChildren, RefObject } from 'preact';

export interface DialogShortcuts {
  /** The dialog's method — which shortcuts apply. */
  method: string;
  /** The choices a `select` offers, in order. */
  options: string[];
  /** The currently highlighted choice. */
  selectedOption: string | null;
  /** Highlight a choice. */
  onSelectOption: (option: string) => void;
  /** The custom-answer field, when the dialog has one. */
  customInputRef: RefObject<HTMLInputElement>;
  /** Answer the dialog (Enter, or ⌘↵ in an editor). */
  onSubmit: () => void;
  /** Dismiss the dialog (Escape). */
  onCancel: () => void;
}

/** Install the dialog's keyboard shortcuts for as long as it is on screen. */
export function useDialogShortcuts({
  method,
  options,
  selectedOption,
  onSelectOption,
  customInputRef,
  onSubmit,
  onCancel,
}: DialogShortcuts) {
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }

      if (method === 'select' && options.length > 0) {
        // Typing in the custom "Other" input must not trigger number/arrow/Enter
        // shortcuts — those keys belong to the text field while focused.
        const typingCustom = e.target instanceof HTMLInputElement && e.target === customInputRef.current;
        if (typingCustom) {
          return;
        }

        const num = parseInt(e.key, 10);
        if (!isNaN(num) && num >= 1 && num <= options.length) {
          e.preventDefault();
          onSelectOption(options[num - 1]);
          return;
        }

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const currentIdx = options.findIndex((o) => o === selectedOption);
          const nextIdx = currentIdx < options.length - 1 ? currentIdx + 1 : 0;
          onSelectOption(options[nextIdx]);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          const currentIdx = options.findIndex((o) => o === selectedOption);
          const prevIdx = currentIdx > 0 ? currentIdx - 1 : options.length - 1;
          onSelectOption(options[prevIdx]);
          return;
        }

        if (e.key === 'Enter' && selectedOption) {
          e.preventDefault();
          onSubmit();
          return;
        }
      }

      if (method === 'confirm') {
        if (e.key === 'Enter') {
          e.preventDefault();
          onSubmit();
          return;
        }
      }

      if (method === 'editor') {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          onSubmit();
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, onSubmit, method, options, selectedOption, onSelectOption, customInputRef]);
}

/** The chrome of one dialog method: its icon, its name and its badge. */
export interface DialogMethodMeta {
  icon: ComponentChildren;
  label: string;
  badge: string;
}

/**
 * The chrome of one dialog method.
 *
 * The badge counts the CHOICES a `select` offers — and for an approval gate
 * that count is the whole decision ("Approve", "Deny"), so it is stated the
 * same way as a question's.
 */
export function dialogMethodMeta(method: string, optionCount: number): DialogMethodMeta {
  switch (method) {
    case 'select':
      return {
        icon: <ListFilter size={16} className="text-ink" />,
        label: 'Decision Required',
        badge: `${optionCount} Choices`,
      };
    case 'confirm':
      return {
        icon: <AlertCircle size={16} className="text-ink" />,
        label: 'Confirmation Required',
        badge: 'Confirm Action',
      };
    case 'input':
      return {
        icon: <Terminal size={16} className="text-ink" />,
        label: 'Prompt Input',
        badge: 'Text Input',
      };
    case 'editor':
      return {
        icon: <FileText size={16} className="text-ink" />,
        label: 'Buffer Editor',
        badge: 'Multiline Buffer',
      };
    default:
      return {
        icon: <HelpCircle size={16} className="text-ink" />,
        label: 'Agent Request',
        badge: 'Input',
      };
  }
}
