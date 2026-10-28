/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two line-blame settings: the inline label, and the whole feature.
 *
 * ## Off by default, and why
 *
 * `editorBlame` defaults ON — hovering a line to learn who wrote it is the
 * feature, and a switch nobody finds is a feature nobody has. `editorBlameInline`
 * defaults OFF, because the label sits at the END of every run's first line: at
 * the panel's 320px floor it turns a long line into two and pushes the code it
 * describes out of the reading column. The card is reachable without it (the
 * line number in the gutter is the other hover target), so the label is the
 * decoration and the card is the feature.
 *
 * ## Reaching an open editor
 *
 * Through `omp:editor-blame-changed`, the shape the font, theme, indent and
 * typing settings all use: `appSettings` is a boot-time prop, so a value read
 * once would never reach an editor already on screen. The event fires only when
 * a value actually moved.
 */

import { useEffect, useState } from 'preact/hooks';
import { readKabmoSetting } from '@/shared/lib/settings/client';

/** Broadcast on every blame-setting write. Detail is the resolved pair. */
export const EDITOR_BLAME_CHANGED_EVENT = 'omp:editor-blame-changed';

export interface EditorBlameOptions {
  /** The card, and the read behind it. Off means no request at all. */
  enabled: boolean;
  /** The label at the end of each run's first line. */
  inline: boolean;
}

export const DEFAULT_EDITOR_BLAME: EditorBlameOptions = { enabled: true, inline: false };

/** The stored pair, falling back per key so one unset does not disable the other. */
export function currentEditorBlame(): EditorBlameOptions {
  if (typeof window === 'undefined') return DEFAULT_EDITOR_BLAME;
  const enabled = readKabmoSetting<boolean>('editorBlame');
  const inline = readKabmoSetting<boolean>('editorBlameInline');
  return {
    enabled: typeof enabled === 'boolean' ? enabled : DEFAULT_EDITOR_BLAME.enabled,
    inline: typeof inline === 'boolean' ? inline : DEFAULT_EDITOR_BLAME.inline,
  };
}

/** The stored pair, kept in step with writes from the settings modal. */
export function useEditorBlame(): EditorBlameOptions {
  const [blame, setBlame] = useState<EditorBlameOptions>(currentEditorBlame);

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<EditorBlameOptions>).detail;
      setBlame(detail ?? currentEditorBlame());
    };
    window.addEventListener(EDITOR_BLAME_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(EDITOR_BLAME_CHANGED_EVENT, onChange);
  }, []);

  return blame;
}
