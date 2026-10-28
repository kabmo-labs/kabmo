/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Settings → Appearance → Editor blame.
 *
 * Two switches rather than one, because they answer different questions: the
 * card is the FEATURE (a hover that names the author and the commit), and the
 * inline label is a DECORATION that costs horizontal room on every attributed
 * line. A user who wants the first without the second is the common case — the
 * editor panel is 320px wide at its floor.
 *
 * Both reach an editor that is already open through
 * `EDITOR_BLAME_CHANGED_EVENT`; `appSettings` is a boot-time prop, so a value
 * read once would never arrive. The event fires only when a value moved.
 */

import { readKabmoSetting, writeKabmoSettings } from '@/shared/lib/settings/client';
import type { SettingsState } from '@/shared/types';
import {
  DEFAULT_EDITOR_BLAME,
  EDITOR_BLAME_CHANGED_EVENT,
  currentEditorBlame,
} from '@/client/hooks/editor/blame-settings';

interface EditorBlameSectionProps {
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
        onChange={(event) => onChange((event.target as HTMLInputElement).checked)}
        className="mt-0.5 shrink-0 accent-ink"
      />
    </label>
  );
}

export function EditorBlameSection({ settings: _settings, onUpdate }: EditorBlameSectionProps) {
  const enabled = readKabmoSetting<boolean>('editorBlame');
  const inline = readKabmoSetting<boolean>('editorBlameInline');
  const resolved = currentEditorBlame();

  const commit = (patch: { editorBlame?: boolean; editorBlameInline?: boolean }) => {
    const next = { ...currentEditorBlame(), ...patch };
    writeKabmoSettings(patch);
    onUpdate((previous) => ({ ...previous }));
    window.dispatchEvent(new CustomEvent(EDITOR_BLAME_CHANGED_EVENT, { detail: next }));
  };

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-ink">Line blame</h4>
        <p className="text-[11px] text-ink/50 mt-0.5">
          Who last touched a line, and which commit. Read from git, so it needs a committed file.
        </p>
      </div>
      <div className="space-y-2.5 rounded-lg border border-ink/10 p-3">
        <Toggle
          label="Show blame on hover"
          hint="Hover a line number — or the label, when it is on — to see the author, the commit and the line's own history."
          checked={typeof enabled === 'boolean' ? enabled : DEFAULT_EDITOR_BLAME.enabled}
          onChange={(value) => commit({ editorBlame: value })}
        />
        <Toggle
          label="Show the label in the editor"
          hint={`Puts “author · age” at the end of each block. It costs horizontal room, so it is off on a narrow panel by default (${resolved.inline ? 'on' : 'off'}).`}
          checked={typeof inline === 'boolean' ? inline : DEFAULT_EDITOR_BLAME.inline}
          onChange={(value) => commit({ editorBlameInline: value })}
        />
      </div>
    </section>
  );
}
