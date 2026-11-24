/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Dictation: which engine transcribes the composer's mic, in which
 * language, and with what.
 *
 * A category of its own rather than a section of Chats because it decides where
 * AUDIO GOES — a privacy fact, not a layout one — and because the local engine
 * can be unavailable on a given omp version, which the page has to say in words.
 *
 * The page reads two server facts (`hasApiKey`, local capability) through one
 * hook and writes the rest as ordinary settings. The engine cards are
 * `aria-pressed` buttons: there is no submit, the choice applies on click, and
 * the modal's `onUpdate` persists it.
 */

import type { SettingsState } from '@/shared/types';
import { useDictationServerState } from '@/client/hooks/settings/dictation';
import { EngineSection } from '@/client/components/settings/categories/dictation-settings/EngineSection';
import { LanguageSection } from '@/client/components/settings/categories/dictation-settings/LanguageSection';
import { ExternalSection } from '@/client/components/settings/categories/dictation-settings/ExternalSection';
import { CaptureSection } from '@/client/components/settings/categories/dictation-settings/CaptureSection';

export interface DictationSettingsProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

export function DictationSettings({ settings, onUpdate }: DictationSettingsProps) {
  const server = useDictationServerState();
  const config = settings.dictation;

  const patch = (next: Partial<SettingsState['dictation']>) => {
    onUpdate({ dictation: { ...config, ...next } });
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-7">
      <p className="text-[11px] leading-relaxed text-ink/60">
        The composer's mic button. The language you pick here is what the recognizer is told — with
        the wrong one, Indonesian speech is decoded as English words that sound similar, and English
        speech is mangled the other way round.
      </p>

      {server.error && (
        <p className="rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2 text-[11px] leading-relaxed text-ink/70">
          {server.error}
        </p>
      )}

      <EngineSection
        config={config}
        local={server.state?.local}
        busy={server.busy}
        onSelect={(engine) => patch({ engine })}
        onReprobe={() => void server.reprobe()}
      />

      <LanguageSection config={config} onSelect={(language) => patch({ language })} />

      <ExternalSection
        config={config}
        hasApiKey={server.state?.hasApiKey ?? false}
        busy={server.busy}
        onPatch={patch}
        onSaveKey={(apiKey) => void server.saveApiKey(apiKey)}
        onClearKey={() => void server.clearApiKey()}
      />

      <CaptureSection config={config} onPatch={patch} />
    </div>
  );
}
