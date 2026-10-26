/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor's indentation SETTING: how wide a level is, and what a Tab inserts.
 *
 * The surface has always hardcoded two spaces (`extensions.ts`' `INDENT`), which is
 * wrong for every 4-space repository — and now that the auto-indent rules emit
 * `indentUnit`, the setting propagates through them for free (the service reads
 * `ctx.unit`, which is `getIndentUnit(state)`).
 *
 * ## The setting reaches an open editor through an EVENT
 *
 * Same reason the font and the theme do: `appSettings` is a boot-time prop, so a
 * value read once would not reach the editor already on screen. The picker writes
 * the setting AND announces it; the editor subscribes. The event fires only when the
 * value actually moved, or every unrelated settings toggle would churn every
 * editor's configuration — and a reconfigure re-creates the editor's plugins,
 * including the tokenizer.
 *
 * ## Two facets, because they answer different questions
 *
 * `EditorState.tabSize` is what a literal TAB character counts as. `indentUnit` is
 * what one indentation LEVEL is, and it is what `indentMore`/`indentLess` and the
 * indent service emit. A tab-indented repository wants both to be 1 tab; a
 * space-indented one wants a width and `insertSpaces`.
 */

import { useEffect, useState } from 'preact/hooks';
import { readKabmoSetting } from '@/shared/lib/settings/client';

/** Broadcast on every indentation-setting write. Detail is the new value. */
export const EDITOR_INDENT_CHANGED_EVENT = 'omp:editor-indent-changed';

/** The widths the picker offers. */
export const EDITOR_INDENT_WIDTHS: readonly number[] = [2, 4, 8];

/** What the editor's indentation resolves to. */
export interface EditorIndentSettings {
  /** Columns in one level. */
  width: number;
  /** `false` means a level is one TAB character. */
  insertSpaces: boolean;
}

export const DEFAULT_EDITOR_INDENT: EditorIndentSettings = { width: 2, insertSpaces: true };

/** The stored indentation, falling back to the shipped default. */
export function currentEditorIndent(): EditorIndentSettings {
  if (typeof window === 'undefined') return DEFAULT_EDITOR_INDENT;
  const width = readKabmoSetting<number>('editorIndentWidth');
  const spaces = readKabmoSetting<boolean>('editorInsertSpaces');
  return {
    // A stored width outside the offered set is a downgrade or a hand-edited row;
    // the surface must not be configured with a value the picker cannot show.
    width: typeof width === 'number' && EDITOR_INDENT_WIDTHS.includes(width) ? width : DEFAULT_EDITOR_INDENT.width,
    insertSpaces: typeof spaces === 'boolean' ? spaces : DEFAULT_EDITOR_INDENT.insertSpaces,
  };
}

/**
 * The indentation unit as a string — what `indentUnit.of` takes.
 *
 * `'\t'` for a tab-indented setting, which is the ONE way `indentUnit` accepts a
 * tab: the facet is documented as "a string consisting entirely of the same
 * whitespace character".
 */
export function indentUnitFor(settings: EditorIndentSettings): string {
  return settings.insertSpaces ? ' '.repeat(settings.width) : '\t';
}

/** The stored indentation, kept in step with writes from the settings modal. */
export function useEditorIndent(): EditorIndentSettings {
  const [settings, setSettings] = useState<EditorIndentSettings>(currentEditorIndent);

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<EditorIndentSettings>).detail;
      setSettings(detail ?? currentEditorIndent());
    };
    window.addEventListener(EDITOR_INDENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(EDITOR_INDENT_CHANGED_EVENT, onChange);
  }, []);

  return settings;
}
