/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two BEHAVIOUR settings for the editor: auto-close brackets, and the
 * document-words completer.
 *
 * They are settings rather than always-on because both change what TYPING does. A view
 * preference can be ignored by a user who does not like it; an auto-inserted `}` cannot.
 * Both default ON, because that is what every editor does and a user who has never seen
 * the setting would otherwise wonder why typing is different here.
 *
 * ## The completer is not LSP
 *
 * It suggests words that already appear near the caret. That works in every language with
 * no server, which is the same reason the surface has no grammar — and it is bounded to a
 * window around the caret, because a whole-document scan per keystroke is exactly the cost
 * the CodeMirror migration removed.
 *
 * ## Reaching an open editor
 *
 * Through `omp:editor-typing-changed`, the same shape the font, theme and indent settings
 * use: `appSettings` is a boot-time prop, so a value read once would not reach the editor
 * already on screen.
 */

import { useEffect, useState } from 'preact/hooks';
import { readKabmoSetting } from '@/shared/lib/settings/client';

import type { EditorTypingOptions } from '@/client/components/common/code-surface/typing';

/** Broadcast on every typing-setting write. Detail is the resolved pair. */
export const EDITOR_TYPING_CHANGED_EVENT = 'omp:editor-typing-changed';

/** Both ON: what every editor does, and what a user who never opens Settings expects. */
export const DEFAULT_EDITOR_TYPING: EditorTypingOptions = { autoCloseBrackets: true, autocomplete: true };

/** The stored pair, falling back per key so one unset does not disable the other. */
export function currentEditorTyping(): EditorTypingOptions {
  if (typeof window === 'undefined') return DEFAULT_EDITOR_TYPING;
  const close = readKabmoSetting<boolean>('editorAutoCloseBrackets');
  const complete = readKabmoSetting<boolean>('editorAutocomplete');
  return {
    autoCloseBrackets: typeof close === 'boolean' ? close : DEFAULT_EDITOR_TYPING.autoCloseBrackets,
    autocomplete: typeof complete === 'boolean' ? complete : DEFAULT_EDITOR_TYPING.autocomplete,
  };
}

/** The stored pair, kept in step with writes from the settings modal. */
export function useEditorTyping(): EditorTypingOptions {
  const [typing, setTyping] = useState<EditorTypingOptions>(currentEditorTyping);

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<EditorTypingOptions>).detail;
      setTyping(detail ?? currentEditorTyping());
    };
    window.addEventListener(EDITOR_TYPING_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(EDITOR_TYPING_CHANGED_EVENT, onChange);
  }, []);

  return typing;
}
