/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor font setting, and how a live change reaches an open editor.
 *
 * The setting is visual, so it has to apply to the editor the user is looking
 * at — not on the next reload. That rules out reading it once from the
 * bootstrap payload the way `keybindingSend` is read: `appSettings` is a prop
 * captured at boot, so a settings change would not reach an already-mounted
 * editor. The theme solved the same problem with a window event, and this
 * follows it: the picker writes the setting AND announces it, and the editor
 * subscribes.
 *
 * The stored value is the family name. `editorFontStack` puts it in front of
 * the shared stack, so a face the device lacks falls through to the bundled
 * Fira Code instead of replacing it — which is why the picker can offer faces
 * the app does not ship.
 */

import { useEffect, useState } from 'preact/hooks';
import { readKabmoSetting } from '@/shared/lib/settings/client';
import {
  EDITOR_DEFAULT_FONT_FAMILY,
  editorFontStack,
} from '@/shared/lib/code/editor/typography';

/** Broadcast on every editor-font write. Detail is the new family name. */
export const EDITOR_FONT_CHANGED_EVENT = 'omp:editor-font-changed';

/** The family currently stored, falling back to the shipped default. */
export function currentEditorFont(): string {
  if (typeof window === 'undefined') return EDITOR_DEFAULT_FONT_FAMILY;
  return readKabmoSetting<string>('editorFont') ?? EDITOR_DEFAULT_FONT_FAMILY;
}

/** The stored family and the stack it resolves to, kept in step with writes. */
export function useEditorFontStack(): string {
  const [family, setFamily] = useState<string>(currentEditorFont);

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setFamily(detail || currentEditorFont());
    };
    window.addEventListener(EDITOR_FONT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(EDITOR_FONT_CHANGED_EVENT, onChange);
  }, []);

  return editorFontStack(family);
}
