import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ChangeEvent, RefObject } from 'preact/compat';
import type { TargetedKeyboardEvent } from 'preact';
import type { ComposerMatchItem, ComposerPickItem, ComposerTrigger } from '@/shared/types';
import { detectComposerTrigger, insertToken, sendInsteadOfAccept, tokenForItem } from '@/shared/lib/chat/composer/trigger';
import { filterComposerItems } from '@/shared/lib/chat/composer/filter';
import { useComposerItems } from '@/client/hooks/chat/composer/items';

export interface UseComposerTriggerOptions {
  value: string;
  setValue: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  disabled?: boolean;
  /** Workspace root to scope `@` file mentions to (null → app root). */
  rootPath?: string | null;
  /** The open chat, so `/` can ask ITS agent for the command list (ACP agents
   *  publish their own; omp's utility catalog is a different vocabulary). */
  sessionId?: string | null;
  /**
   * Whether the popup may open at all. A composer with no completable surface
   * (the side-question form) turns it off so a stray `@` or `/` cannot open an
   * empty list over its text.
   */
  enabled?: boolean;
}

export interface ComposerTriggerController {
  trigger: ComposerTrigger | null;
  isOpen: boolean;
  matches: ComposerMatchItem[];
  loading: boolean;
  error: string | null;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  handleChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  handleCompositionStart: () => void;
  handleCompositionEnd: () => void;
  handleKeyDown: (e: TargetedKeyboardEvent<HTMLTextAreaElement>) => boolean;
  selectItem: (item: ComposerPickItem) => void;
  close: () => void;
  listboxId: string;
  optionId: (index: number) => string;
}

function isComposingInput(native: Event): boolean {
  const input = native as InputEvent;
  return (
    input.isComposing === true ||
    input.inputType?.startsWith('insertFromPaste') === true ||
    input.inputType?.startsWith('insertFromDrop') === true
  );
}

/**
 * Whether the popup may open for this trigger. oh-my-pi only shows the command
 * popup once the slash token has a real match — a bare `/`, a `/tmp/fo` path,
 * or a completed `/retry ` must not cover the composer with an empty list.
 * Mentions keep their own rule: the empty state tells the user what `@` accepts.
 */
function shouldOpen(trigger: ComposerTrigger | null, matches: ComposerMatchItem[]): boolean {
  if (!trigger) return false;
  return trigger.kind === 'mention' || matches.length > 0;
}

/** Orchestrates the composer `@`-mention / `/`-command autocomplete flow. */
export function useComposerTrigger(options: UseComposerTriggerOptions): ComposerTriggerController {
  const { value, setValue, textareaRef, disabled = false, rootPath, sessionId, enabled = true } = options;

  const [trigger, setTrigger] = useState<ComposerTrigger | null>(null);
  const [activeIndex, setActiveIndexState] = useState(0);
  const composingRef = useRef(false);
  const pendingCaretRef = useRef<number | null>(null);

  const { items, loading, error } = useComposerItems(trigger?.kind ?? null, rootPath ?? null, sessionId ?? null);

  const matches = useMemo(
    () => (trigger ? filterComposerItems(items, trigger) : []),
    [items, trigger],
  );

  const clampedIndex = matches.length > 0
    ? Math.min(Math.max(activeIndex, 0), matches.length - 1)
    : -1;

  const listboxId = useId();

  const optionId = useCallback((index: number) => `${listboxId}-option-${index}`, [listboxId]);

  const open = enabled && shouldOpen(trigger, matches);

  const close = useCallback(() => {
    setTrigger(null);
    setActiveIndexState(0);
  }, []);

  const setActiveIndex = useCallback((index: number) => {
    setActiveIndexState(index);
  }, []);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
  }, []);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      const text = el.value;
      const caret = el.selectionStart ?? text.length;

      if (composingRef.current || isComposingInput(e)) {
        setValue(text);
        close();
        return;
      }

      setValue(text);
      if (disabled || !enabled) {
        close();
        return;
      }
      setTrigger(detectComposerTrigger(text, caret));
      setActiveIndexState(0);
    },
    [setValue, close, disabled, enabled],
  );

  const selectItem = useCallback(
    (item: ComposerPickItem) => {
      if (!trigger) return;
      const next = insertToken(value, trigger, tokenForItem(item));
      pendingCaretRef.current = next.caret;
      setValue(next.value);
      // Re-query instead of closing: oh-my-pi reopens on the accepted text, so
      // `/fast` → `/fast ` immediately offers its subcommands and the collapsed
      // `/skill:` row expands into the individual skills. `shouldOpen` keeps a
      // completed command from leaving an empty popup behind.
      setTrigger(detectComposerTrigger(next.value, next.caret));
      setActiveIndexState(0);
    },
    [value, trigger, setValue],
  );

  const handleKeyDown = useCallback(
    (e: TargetedKeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (composingRef.current || e.keyCode === 229) return false;
      // A closed popup owns nothing: `/tmp/fo` must keep Enter/Tab meaning send
      // and indent rather than being swallowed by an invisible list.
      if (!trigger || !open) return false;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (matches.length > 0) {
          const delta = e.key === 'ArrowDown' ? 1 : -1;
          setActiveIndexState((clampedIndex + delta + matches.length) % matches.length);
        }
        return true;
      }

      if ((e.key === 'Enter' || e.key === 'Tab') && matches.length > 0) {
        // A complete command with nothing left to complete: Enter is a send, so
        // drop the popup rather than consuming the keystroke.
        if (e.key === 'Enter' && sendInsteadOfAccept(trigger, matches[clampedIndex])) {
          close();
          return false;
        }
        e.preventDefault();
        e.stopPropagation();
        selectItem(matches[clampedIndex]);
        return true;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return true;
      }

      return false;
    },
    [trigger, open, matches, clampedIndex, selectItem, close],
  );

  useLayoutEffect(() => {
    if (pendingCaretRef.current == null) return;
    const caret = pendingCaretRef.current;
    pendingCaretRef.current = null;
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(caret, caret);
    }
  }, [value, textareaRef]);

  return {
    trigger,
    isOpen: open,
    matches,
    loading,
    error,
    activeIndex: clampedIndex,
    setActiveIndex,
    handleChange,
    handleCompositionStart,
    handleCompositionEnd,
    handleKeyDown,
    selectItem,
    close,
    listboxId,
    optionId,
  };
}
