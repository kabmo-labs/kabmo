/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Appearance → Editor indentation.
 *
 * One control, because there is one decision: how wide a level is. "Insert spaces"
 * is not a second preference — it is what the width MEANS, and offering them
 * separately would let a user pick "4 columns, tabs", which is two answers to one
 * question.
 *
 * A change has to reach an editor that is ALREADY open, which rules out reading
 * `appSettings`: that is a boot-time prop the editor only sees again after a reload.
 * The picker therefore broadcasts `EDITOR_INDENT_CHANGED_EVENT` and
 * `useEditorIndent` subscribes — the same shape the font and theme pickers use. The
 * event fires only when the value actually moved, or every unrelated settings
 * toggle would reconfigure every editor's indent compartment.
 */

import { readKabmoSetting, writeKabmoSettings } from '@/shared/lib/settings/client';
import type { SettingsState } from '@/shared/types';
import {
  DEFAULT_EDITOR_INDENT,
  EDITOR_INDENT_CHANGED_EVENT,
  EDITOR_INDENT_WIDTHS,
  currentEditorIndent,
  type EditorIndentSettings,
} from '@/client/hooks/editor/indent-settings';

interface EditorIndentSectionProps {
  settings: SettingsState;
  /** Kept for the shared section signature; the value is read from the blob. */
  onUpdate: (updater: Partial<SettingsState> | ((previous: SettingsState) => SettingsState)) => void;
}

export function EditorIndentSection({ settings: _settings, onUpdate }: EditorIndentSectionProps) {
  // The stored width, with the same guard `currentEditorIndent` applies: a value
  // outside the offered set (a downgrade, a hand-edited row) must not be shown as a
  // selected option that does not exist.
  const stored = readKabmoSetting<number>('editorIndentWidth');
  const width = typeof stored === 'number' && EDITOR_INDENT_WIDTHS.includes(stored) ? stored : DEFAULT_EDITOR_INDENT.width;

  const choose = (next: number) => {
    if (next === width) return;
    const value: EditorIndentSettings = { ...currentEditorIndent(), width: next };
    writeKabmoSettings({ editorIndentWidth: next, editorInsertSpaces: true });
    // The row is written through the blob above, which is what every reader resolves;
    // this keeps the modal's own copy in step so the picker reflects the click
    // without a reload.
    onUpdate((previous) => ({ ...previous }));
    // Live: an editor already on screen reconfigures its indent compartment.
    window.dispatchEvent(new CustomEvent<EditorIndentSettings>(EDITOR_INDENT_CHANGED_EVENT, { detail: value }));
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-xs font-semibold text-ink">Editor indentation</h4>
          <p className="text-[11px] text-ink/50 mt-0.5">
            One level, in spaces. Enter, Tab and the auto-indent rules all use it.
          </p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Indentation width">
          {EDITOR_INDENT_WIDTHS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => choose(option)}
              aria-pressed={option === width}
              aria-label={`${option} spaces`}
              className={`px-2.5 py-1 rounded border text-[11px] font-mono transition-colors cursor-pointer ${
                option === width
                  ? 'border-ink/40 bg-ink/10 text-ink'
                  : 'border-ink/15 text-ink/60 hover:bg-ink/5 hover:text-ink'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
