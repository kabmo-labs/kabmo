/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Inline rename state shared by the desktop session row and the mobile
 * session row. Owns the edit/draft pair, the input ref, and the Escape/blur
 * handshake: Escape flips `cancelRef` so the ensuing blur is a no-op (no
 * accidental commit), and the input is selected as soon as editing starts.
 *
 * The input's markup (classes, stopPropagation, layout) stays in each
 * component — only the behavior lives here.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import type { RefObject } from 'preact/compat';

export interface InlineRename {
  isEditing: boolean;
  draft: string;
  setDraft: (value: string) => void;
  inputRef: RefObject<HTMLInputElement>;
  startRename: () => void;
  commitRename: () => void;
  cancelRename: () => void;
  handleKeyDown: (e: TargetedKeyboardEvent<HTMLInputElement>) => void;
  handleBlur: () => void;
}

export function useInlineRename(
  value: string,
  onCommit?: (name: string) => void,
): InlineRename {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape flips this so the ensuing blur is a no-op (no accidental commit).
  const cancelRef = useRef(false);
  // Enter commits and closes the field; the blur that follows the unmount is
  // the SAME commit, and without this flag it fired the rename request twice.
  const committedRef = useRef(false);

  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);

  const startRename = () => {
    cancelRef.current = false;
    committedRef.current = false;
    setDraft(value);
    setIsEditing(true);
  };

  const commitRename = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = draft.trim();
    setIsEditing(false);
    if (!trimmed || trimmed === value) return;
    onCommit?.(trimmed);
  };

  const cancelRename = () => {
    cancelRef.current = true;
    setIsEditing(false);
  };

  const handleKeyDown = (e: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  };

  const handleBlur = () => {
    if (cancelRef.current) {
      cancelRef.current = false;
      return;
    }
    commitRename();
  };

  return {
    isEditing,
    draft,
    setDraft,
    inputRef,
    startRename,
    commitRename,
    cancelRename,
    handleKeyDown,
    handleBlur,
  };
}
