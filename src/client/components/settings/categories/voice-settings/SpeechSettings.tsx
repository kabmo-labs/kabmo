/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Voice → Speech.
 *
 * The page reads two server facts (`hasKeys` per hosted engine, and whether omp's
 * `say` command runs) through one hook and writes the rest as ordinary settings.
 * The engine cards are `aria-pressed` buttons: there is no submit, the choice
 * applies on click, and the modal's `onUpdate` persists it.
 */

import type { SettingsState } from '@/shared/types';
import { clampTtsSpeed, type TtsEngine } from '@/shared/lib/tts/engines';
import { useSpeechServerState } from '@/client/hooks/settings/speech';
import { SpeechEngineSection } from '@/client/components/settings/categories/voice-settings/speech/EngineSection';
import { SpeechVoiceSection } from '@/client/components/settings/categories/voice-settings/speech/VoiceSection';
import { SpeechEndpointSection } from '@/client/components/settings/categories/voice-settings/speech/EndpointSection';
import { SpeechAutoplaySection } from '@/client/components/settings/categories/voice-settings/speech/AutoplaySection';
import { SpeechTestSection } from '@/client/components/settings/categories/voice-settings/speech/TestSection';

export interface SpeechSettingsProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

export function SpeechSettings({ settings, onUpdate }: SpeechSettingsProps) {
  const server = useSpeechServerState();
  const config = settings.tts;

  const patch = (next: Partial<SettingsState['tts']>) => {
    onUpdate({ tts: { ...config, ...next } });
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-7">
      <p className="text-[11px] leading-relaxed text-ink/60">
        The speaker button under an assistant answer. The engine you pick here is where that
        answer's text goes — the local engine keeps it on this machine, a hosted engine uploads it.
      </p>

      {server.error && (
        <p className="rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2 text-[11px] leading-relaxed text-ink/70">
          {server.error}
        </p>
      )}

      <SpeechEngineSection
        config={config}
        local={server.state?.local}
        busy={server.busy}
        onSelect={(engine: TtsEngine) => patch({
          engine,
          // A model or voice id from the previous engine is meaningless here —
          // forwarding an OpenAI model to ElevenLabs is a request that cannot
          // work. Empty means "this engine's default".
          model: '',
          voice: '',
          speed: clampTtsSpeed(engine, config.speed),
          baseUrl: engine === 'openai' ? config.baseUrl : '',
          language: engine === 'xai' ? config.language : '',
        })}
        onReprobe={() => void server.reprobe()}
      />

      <SpeechVoiceSection config={config} onPatch={patch} />

      <SpeechEndpointSection
        config={config}
        hasKey={server.state?.hasKeys[config.engine] ?? false}
        busy={server.busy}
        onPatch={patch}
        onSaveKey={(engine, apiKey) => void server.saveKey(engine, apiKey)}
        onClearKey={(engine) => void server.clearKey(engine)}
      />

      <SpeechAutoplaySection config={config} onPatch={patch} />

      <SpeechTestSection config={config} />
    </div>
  );
}
