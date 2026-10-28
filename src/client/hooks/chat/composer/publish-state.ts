/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Publish one composer's live state to the plugin kit.
 *
 * A plugin's `useComposer().set()` must go through the SAME state the composer
 * owns — the textarea is controlled, so a DOM write is reverted by the next
 * keystroke and the plugin's edit vanishes with no error. This hook is that
 * writer: it closes over `onChange` and the element, and registers itself as
 * the live composer while it is mounted.
 *
 * Extracted from the composer component because the component is at the repo's
 * per-file ceiling, and because the rules here are the hook's own:
 *
 * - **The caret decides where an insert lands.** `insert` puts text at the
 *   selection and moves the caret past it, so two inserts in a row do not both
 *   land at the old position.
 * - **A composer that unmounts drops its writer.** A plugin's later `insert`
 *   would otherwise land in a gone element and vanish silently.
 */

import { useCallback, useEffect, useRef } from 'preact/hooks';
import { clearComposerWriter, setComposerState } from '@/client/lib/plugins/composer-bridge';

export interface PublishComposerStateOptions {
  value: string;
  onChange: (next: string) => void;
  isSubmitting: boolean;
  sessionId: string | null;
}

/** What the composer hands the textarea's `onReady`, so the writer can reach it. */
export interface ComposerStatePublisher {
  onTextareaReady: (element: HTMLTextAreaElement | null) => void;
}

export function usePublishComposerState({
  value,
  onChange,
  isSubmitting,
  sessionId,
}: PublishComposerStateOptions): ComposerStatePublisher {
  // The element, for the caret. Its own ref rather than the grow hook's: that
  // one is owned by a caller measuring the box, and two writers of one ref is
  // how a plugin's caret and a measurement end up fighting.
  const element = useRef<HTMLTextAreaElement | null>(null);

  const onTextareaReady = useCallback((node: HTMLTextAreaElement | null) => {
    element.current = node;
  }, []);

  useEffect(() => {
    setComposerState(
      {
        text: value,
        isEmpty: value.trim().length === 0,
        isSubmitting,
        scope: { kind: 'session', sessionId },
      },
      {
        set: (next) => onChange(next),
        insert: (text) => {
          const node = element.current;
          const caret = node?.selectionStart ?? value.length;
          onChange(`${value.slice(0, caret)}${text}${value.slice(caret)}`);
          const after = caret + text.length;
          requestAnimationFrame(() => node?.setSelectionRange(after, after));
        },
        focus: () => element.current?.focus(),
      },
    );
  }, [value, isSubmitting, sessionId, onChange]);

  useEffect(() => () => clearComposerWriter(), []);

  return { onTextareaReady };
}
