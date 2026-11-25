/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Git → Commit messages.
 *
 * The Source Control panel is global, so the agent that writes a commit message
 * has to be a setting rather than "whatever chat is open" alone. `auto` is the
 * default because it needs no configuration: it follows the active chat's
 * harness and uses omp when no chat is open. The other modes exist for the two
 * cases `auto` cannot express — pinning a cheap agent, and turning the action
 * off.
 *
 * The prompt is a TEMPLATE, not free text: the server fills its placeholders
 * from the staged change set. `{{diff}}` is required, because a prompt that
 * never sees the diff is the Orca #20112 failure — the model describes the
 * template's own example in every repository. The editor refuses to save one.
 */

import { useEffect, useState } from 'preact/hooks';
import { Ban, Bot, Check, Cpu, RotateCcw, Save, Sparkles } from 'lucide-preact';
import type { SettingsState } from '@/shared/types';
import { SearchSelect } from '@/client/components/common/search-select';
import { useHarnesses } from '@/client/hooks/models/use-harnesses';
import {
  COMMIT_PROMPT_PLACEHOLDERS,
  DEFAULT_COMMIT_MESSAGE_PROMPT,
  validateCommitPrompt,
} from '@/shared/lib/git/commit-prompt';

interface CommitMessageSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

const MODES: Array<{
  value: SettingsState['commitMessageMode'];
  label: string;
  badge: string;
  icon: typeof Sparkles;
  description: string;
  note: string;
}> = [
  {
    value: 'auto',
    label: 'Auto',
    badge: 'Default',
    icon: Sparkles,
    description:
      'The active chat\'s harness writes the message — Claude Code, Codex, opencode, or whichever agent you are talking to. With no chat open it uses omp\'s commit role.',
    note: 'Follows the active chat',
  },
  {
    value: 'omp',
    label: 'omp',
    badge: 'Commit role',
    icon: Cpu,
    description:
      'Always use omp\'s commit role (tiny when unset) through a one-shot `omp -p` call. Fast and cheap, and it never touches the repository: the call runs with no session and no tools.',
    note: 'No session, no tools',
  },
  {
    value: 'harness',
    label: 'Harness',
    badge: 'ACP',
    icon: Bot,
    description:
      'Pin one ACP agent. It runs one disposable session with its own auth and model, and every tool permission is denied — the diff in the prompt is all it gets.',
    note: 'One disposable session',
  },
  {
    value: 'off',
    label: 'Off',
    badge: 'Opt-out',
    icon: Ban,
    description:
      'The Generate button is hidden. Commit messages are typed by hand, exactly as before this feature existed.',
    note: 'No model calls',
  },
];

export function CommitMessageSection({ settings, onUpdate }: CommitMessageSectionProps) {
  const mode = settings.commitMessageMode ?? 'auto';
  const harness = settings.commitMessageHarness ?? '';
  const model = settings.commitMessageModel ?? '';
  const customPrompt = settings.commitMessagePrompt ?? '';
  const { harnesses } = useHarnesses();
  const acpHarnesses = harnesses.filter((entry) => entry.transport === 'acp' && entry.enabled);
  const selectedHarness = acpHarnesses.find((entry) => entry.id === harness);
  const [modelText, setModelText] = useState(model);
  const [promptText, setPromptText] = useState(customPrompt || DEFAULT_COMMIT_MESSAGE_PROMPT);

  // The stored value can change from another tab; adopt it only while this
  // field is not the one being typed into.
  useEffect(() => {
    setModelText(model);
  }, [model]);

  useEffect(() => {
    setPromptText(customPrompt || DEFAULT_COMMIT_MESSAGE_PROMPT);
  }, [customPrompt]);

  const commitModel = () => {
    const next = modelText.trim();
    setModelText(next);
    if (next !== model) onUpdate({ commitMessageModel: next });
  };

  const promptValidation = validateCommitPrompt(promptText);
  const promptDirty = promptText.trim() !== (customPrompt || DEFAULT_COMMIT_MESSAGE_PROMPT).trim();

  const savePrompt = () => {
    if (!promptValidation.ok) return;
    // Saving the built-in text is the same as having no override; storing it
    // would make the badge say "Custom" for a prompt nobody changed.
    const next = promptText.trim() === DEFAULT_COMMIT_MESSAGE_PROMPT.trim() ? '' : promptText;
    onUpdate({ commitMessagePrompt: next });
  };

  const resetPrompt = () => {
    setPromptText(DEFAULT_COMMIT_MESSAGE_PROMPT);
    // An unsaved edit is discarded by the textarea write above; only a stored
    // override needs the settings write.
    if (customPrompt) onUpdate({ commitMessagePrompt: '' });
  };

  const willUse = mode === 'off'
    ? 'Off'
    : mode === 'auto'
      ? 'Active chat harness · omp when no chat is open'
      : mode === 'omp'
        ? `omp · ${model || 'commit role'}`
        : selectedHarness
          ? `${selectedHarness.label} · ${model || 'default model'}`
          : 'No harness selected';

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Commit Messages</h4>
        <p className="text-[11px] text-ink/60 mt-0.5">
          Which agent writes the message behind the Source Control panel's Generate button. Only staged changes are described.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {MODES.map(({ value, label, badge, icon: Icon, description, note }) => {
          const selected = mode === value;
          const select = () => onUpdate({ commitMessageMode: value });
          return (
            <div
              key={value}
              onClick={select}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && select()}
              className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between select-none ${
                selected
                  ? 'border-ink bg-ink/5 ring-1 ring-ink/20 shadow-xs'
                  : 'border-ink/15 bg-paper hover:border-ink/30 hover:bg-ink/[0.02]'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center ${selected ? 'bg-ink text-paper' : 'bg-ink/5 text-ink/70'}`}>
                      <Icon size={15} />
                    </div>
                    <span className="font-semibold text-xs text-ink">{label}</span>
                  </div>
                  <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-ink/10 text-ink/70 font-medium">{badge}</span>
                </div>
                <p className="text-[11px] text-ink/65 leading-relaxed">{description}</p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-ink/10 flex items-center justify-between text-[11px]">
                <span className="text-ink/50 text-[10px]">{note}</span>
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selected ? 'border-ink bg-ink text-paper' : 'border-ink/30 bg-transparent'}`}>
                  {selected && <Check size={10} strokeWidth={3} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {mode !== 'off' && (
        <div className="rounded-lg border border-ink/15 bg-paper p-3.5 space-y-3">
          {mode === 'harness' && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/45">Harness</label>
              <SearchSelect
                ariaLabel="Commit message harness"
                value={harness}
                onChange={(next) => onUpdate({ commitMessageHarness: next })}
                placeholder="Select a harness…"
                triggerClassName="w-full bg-paper border border-ink/20 rounded-md px-2.5 py-1.5 outline-none focus:border-ink text-[11px] font-medium text-ink cursor-pointer hover:border-ink/40 transition-colors"
                options={acpHarnesses.map((entry) => ({ value: entry.id, label: entry.label }))}
              />
              {acpHarnesses.length === 0 && (
                <p className="mt-1 text-[10px] text-ink/50">
                  No ACP harness is enabled. Add one in Settings → Harnesses.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/45">
              Model override
            </label>
            <input
              type="text"
              value={modelText}
              onChange={(e) => setModelText(e.currentTarget.value)}
              onBlur={commitModel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitModel();
                }
              }}
              placeholder={mode === 'omp' || mode === 'auto' ? 'commit role (default)' : 'harness default'}
              className="w-full bg-paper border border-ink/20 rounded-md px-2.5 py-1.5 text-[11px] text-ink placeholder-ink/40 outline-none focus:border-ink/40 transition-colors font-mono"
            />
            <p className="mt-1 text-[10px] text-ink/50">
              `provider/model`. Leave empty to use the target's own default.
            </p>
          </div>

          <div className="pt-2.5 border-t border-ink/10 flex items-center justify-between gap-3 text-[11px]">
            <span className="text-ink/50">Will use</span>
            <span className="text-ink/80 font-medium text-right">{willUse}</span>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-ink/15 bg-paper p-3.5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-ink/45">Prompt</label>
            <p className="text-[10px] text-ink/50 mt-0.5">
              {customPrompt ? 'Custom prompt' : 'Built-in prompt'}
              {promptDirty ? ' · unsaved changes' : ''}
              {' · '}placeholders are filled from the staged change set.
            </p>
          </div>
          <button
            type="button"
            onClick={resetPrompt}
            disabled={!customPrompt && !promptDirty}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-ink/20 text-[10px] font-medium text-ink/70 hover:bg-ink/5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw size={11} /> Reset to default
          </button>
        </div>

        <textarea
          value={promptText}
          onChange={(e) => setPromptText(e.currentTarget.value)}
          rows={14}
          spellcheck={false}
          className="w-full resize-y min-h-[220px] max-h-[420px] bg-paper border border-ink/20 rounded-md px-2.5 py-1.5 text-[11px] text-ink font-mono outline-none focus:border-ink/40 transition-colors"
        />

        {!promptValidation.ok && (
          <p className="text-[10px] text-error">{promptValidation.error}</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] text-ink/50">
            Placeholders: {COMMIT_PROMPT_PLACEHOLDERS.map((entry) => `{{${entry.key}}}`).join(', ')}
          </p>
          <button
            type="button"
            onClick={savePrompt}
            disabled={!promptDirty || !promptValidation.ok}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-ink text-canvas text-[10px] font-medium hover:bg-ink/90 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Save size={11} /> Save prompt
          </button>
        </div>
      </div>

      <p className="text-[10px] text-ink/45 leading-relaxed">
        The staged diff is sent to the selected harness or provider. Kabmo does not store the prompt or the reply; the generated text is only the commit draft.
      </p>
    </section>
  );
}
