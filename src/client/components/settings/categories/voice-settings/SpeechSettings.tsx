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

import { useEffect } from 'preact/hooks';
import type { SettingsState } from '@/shared/types';
import { clampTtsSpeed, type TtsEngine } from '@/shared/lib/tts/engines';
import { useSpeechServerState } from '@/client/hooks/settings/speech';
import { useLocalTtsModels } from '@/client/hooks/settings/local-tts-models';
import { SpeechEngineSection } from '@/client/components/settings/categories/voice-settings/speech/EngineSection';
import { SpeechModelsSection } from '@/client/components/settings/categories/voice-settings/speech/ModelsSection';
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
  const models = useLocalTtsModels();
  const config = settings.tts;
  const localModels = models.state?.models ?? [];

  // A model id lives in the settings blob; the directory does not. When the
  // model it names is gone (removed in another tab, wiped data dir), leaving the
  // stale id would make every speaker click refuse — so the preference repairs
  // itself to "the first installed model" as soon as the list is known.
  const staleLocalModel = config.engine === 'local'
    && models.state !== null
    && localModels.length > 0
    && config.model !== ''
    && !localModels.some((entry) => entry.id === config.model);
  useEffect(() => {
    if (staleLocalModel) onUpdate({ tts: { ...config, model: '', voice: '' } });
  }, [staleLocalModel, config, onUpdate]);

  const patch = (next: Partial<SettingsState['tts']>) => {
    onUpdate({ tts: { ...config, ...next } });
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-7">
      <p className="text-[11px] leading-relaxed text-ink/60">
        The speaker button under an assistant answer. The engine you pick here is where that
        answer's text goes — the local engine keeps it on this machine, a hosted engine uploads it.
      </p>

      {(server.error ?? models.error) && (
        <p className="rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2 text-[11px] leading-relaxed text-ink/70">
          {server.error ?? models.error}
        </p>
      )}

      <SpeechEngineSection
        config={config}
        local={server.state?.local}
        localRuntime={models.state?.runtime}
        installedModels={localModels.length}
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

      {config.engine === 'local' && (
        <SpeechModelsSection config={config} server={models} onSelect={(model) => patch({ model, voice: '' })} />
      )}

      <SpeechVoiceSection config={config} localModels={localModels} onPatch={patch} />

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
