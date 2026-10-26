/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Settings → Appearance → Editor typing.
 *
 * Two switches, and both are BEHAVIOUR rather than view: they change what typing a
 * character does. That is why they exist at all — a user who does not want an
 * auto-inserted `}` has no way around one, unlike a colour they can ignore.
 *
 * A change reaches an editor that is already open through
 * `EDITOR_TYPING_CHANGED_EVENT`, the same shape the font, theme and indent pickers use:
 * `appSettings` is a boot-time prop, so a value read once would not reach the editor on
 * screen. The event fires only when a value actually moved.
 */

import { readKabmoSetting, writeKabmoSettings } from '@/shared/lib/settings/client';
import type { SettingsState } from '@/shared/types';
import {
  DEFAULT_EDITOR_TYPING,
  EDITOR_TYPING_CHANGED_EVENT,
  currentEditorTyping,
} from '@/client/hooks/editor/typing-settings';

interface EditorTypingSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((previous: SettingsState) => SettingsState)) => void;
}

/** One switch row. */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 cursor-pointer">
      <span className="min-w-0">
        <span className="block text-xs text-ink">{label}</span>
        <span className="block text-[11px] text-ink/50 mt-0.5">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        aria-label={label}
        className="mt-0.5 accent-ink flex-shrink-0"
      />
    </label>
  );
}

export function EditorTypingSection({ settings: _settings, onUpdate }: EditorTypingSectionProps) {
  // Read from the blob, which is what every reader resolves; the `onUpdate` below keeps
  // the modal's own copy in step so the switches reflect a click without a reload.
  const stored = currentEditorTyping();
  const autoClose = readKabmoSetting<boolean>('editorAutoCloseBrackets');
  const autocomplete = readKabmoSetting<boolean>('editorAutocomplete');

  const commit = (patch: { editorAutoCloseBrackets?: boolean; editorAutocomplete?: boolean }) => {
    const next = { ...currentEditorTyping(), ...patch };
    writeKabmoSettings(patch);
    onUpdate((previous) => ({ ...previous }));
    window.dispatchEvent(new CustomEvent(EDITOR_TYPING_CHANGED_EVENT, { detail: next }));
  };

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-ink">Editor typing</h4>
        <p className="text-[11px] text-ink/50 mt-0.5">
          Both change what typing does, which is why they are switches rather than always-on.
        </p>
      </div>
      <div className="space-y-2.5 rounded-lg border border-ink/10 p-3">
        <Toggle
          label="Auto-close brackets"
          hint="Typing ( or { inserts the matching closer, and typing it again steps over it."
          checked={typeof autoClose === 'boolean' ? autoClose : DEFAULT_EDITOR_TYPING.autoCloseBrackets}
          onChange={(value) => commit({ editorAutoCloseBrackets: value })}
        />
        <Toggle
          label="Suggest words from the file"
          hint={`Offers identifiers already near the caret (${stored.autocomplete ? 'on' : 'off'}). Words only — this is not a language server.`}
          checked={typeof autocomplete === 'boolean' ? autocomplete : DEFAULT_EDITOR_TYPING.autocomplete}
          onChange={(value) => commit({ editorAutocomplete: value })}
        />
      </div>
    </section>
  );
}
