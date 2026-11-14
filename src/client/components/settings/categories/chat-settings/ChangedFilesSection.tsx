/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Chats → Transcript → Changed files.
 *
 * One switch over the collapsed "N files changed" list above each run footer.
 * The list is read from the session's agent change journal, so turning it off
 * also stops the read — a reader who does not want the summary pays neither the
 * request nor the space.
 */

import { FileDiff } from 'lucide-preact';
import type { SettingsState } from '@/shared/types';

interface ChatChangedFilesSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

function Switch({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${enabled ? 'Disable' : 'Enable'} ${label}`}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        enabled ? 'bg-ink' : 'bg-ink/20'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-paper shadow ring-0 transition duration-200 ease-in-out ${
          enabled ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export function ChatChangedFilesSection({ settings, onUpdate }: ChatChangedFilesSectionProps) {
  const enabled = settings.showChangedFiles;

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Changed Files</h4>
        <p className="text-[11px] text-ink/60 mt-0.5">
          A collapsed list of the files a run changed, above its footer. Clicking a file opens the
          agent&apos;s own diff — the content it wrote, not the current worktree.
        </p>
      </div>

      <div className="flex items-start justify-between gap-4 py-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-md bg-ink/5 border border-ink/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <FileDiff size={16} className={enabled ? 'text-ink' : 'text-ink/40'} />
          </div>
          <div>
            <div className="text-sm font-semibold text-ink">Show changed files</div>
            <p className="text-ink/65 text-[11px] mt-1 leading-relaxed">
              Read from the session&apos;s change journal. Sessions recorded before omp 18.20.1 have
              no journal, so the list stays empty there.
            </p>
          </div>
        </div>
        <Switch
          label="Show changed files"
          enabled={enabled}
          onToggle={() => onUpdate({ showChangedFiles: !enabled })}
        />
      </div>
    </section>
  );
}
