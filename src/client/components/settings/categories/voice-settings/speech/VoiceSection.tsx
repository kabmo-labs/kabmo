/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Model, voice, rate and language for the selected engine.
 *
 * The voice list is the ENGINE's: omp's own `tts.localVoice` schema values for
 * the local engine (so a new omp release changes one list, not two), the
 * provider's documented voices for a hosted one, and a free-text field where
 * the provider mints ids (a cloned voice, a custom Groq model).
 */

import { OMP_SCHEMA } from '@/shared/lib/omp/config/schema';
import { TTS_LANGUAGES, ttsEngine } from '@/shared/lib/tts/engines';
import type { TtsConfig } from '@/shared/lib/tts/settings';
import { INPUT_CLASS } from '@/client/components/settings/categories/voice-settings/speech/styles';

export interface SpeechVoiceSectionProps {
  config: TtsConfig;
  onPatch: (patch: Partial<TtsConfig>) => void;
}

const LOCAL_VOICES = OMP_SCHEMA.entries['tts.localVoice'];
const LOCAL_VOICE_VALUES = LOCAL_VOICES?.values ?? [];
const LOCAL_VOICE_LABELS = new Map(
  (Array.isArray(LOCAL_VOICES?.ui.options) ? LOCAL_VOICES.ui.options : [])
    .map((option) => [option.value, option.label] as const),
);

function localVoiceLabel(id: string): string {
  return LOCAL_VOICE_LABELS.get(id) ?? id;
}

export function SpeechVoiceSection({ config, onPatch }: SpeechVoiceSectionProps) {
  const spec = ttsEngine(config.engine);
  const modelIsVoice = config.engine === 'deepgram';
  const fixedSpeed = spec.speed.min === spec.speed.max;
  const takesLanguageTag = spec.language === 'required'
    || spec.language === 'parameter'
    || spec.language === 'instructions';

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Voice and rate</h4>
        <p className="mt-0.5 text-[11px] text-ink/60">
          The voice every answer is read in. Rate is clamped to what {spec.label} accepts.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="block text-[11px] font-medium text-ink/70">
            {modelIsVoice ? 'Voice model' : 'Model'}
          </span>
          {modelIsVoice ? (
            <select
              value={config.model || spec.defaultModel}
              onChange={(event) => onPatch({ model: event.currentTarget.value })}
              className={INPUT_CLASS}
            >
              {spec.models.map((model) => (
                <option key={model.id} value={model.id}>{model.label}</option>
              ))}
            </select>
          ) : (
            <>
              <input
                type="text"
                list="tts-models"
                value={config.model}
                placeholder={spec.defaultModel || 'engine default'}
                onInput={(event) => onPatch({ model: event.currentTarget.value })}
                className={INPUT_CLASS}
              />
              <datalist id="tts-models">
                {spec.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </datalist>
            </>
          )}
          {modelIsVoice && (
            <span className="block text-[10px] text-ink/50">Deepgram's model id is its voice.</span>
          )}
        </label>

        {!modelIsVoice && (
          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-ink/70">Voice</span>
            {config.engine === 'omp' ? (
              <select
                value={config.voice}
                onChange={(event) => onPatch({ voice: event.currentTarget.value })}
                className={INPUT_CLASS}
              >
                <option value="">
                  omp default ({typeof LOCAL_VOICES?.default === 'string' ? localVoiceLabel(LOCAL_VOICES.default) : 'harper'})
                </option>
                {LOCAL_VOICE_VALUES.map((value) => (
                  <option key={value} value={value}>{localVoiceLabel(value)}</option>
                ))}
              </select>
            ) : (
              <>
                <input
                  type="text"
                  list="tts-voices"
                  value={config.voice}
                  placeholder={spec.defaultVoice || 'engine default'}
                  onInput={(event) => onPatch({ voice: event.currentTarget.value })}
                  className={INPUT_CLASS}
                />
                <datalist id="tts-voices">
                  {spec.voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
                </datalist>
              </>
            )}
            <span className="block text-[10px] text-ink/50">
              {config.engine === 'omp'
                ? '“omp default” follows OMP Engine → Providers → Local TTS Voice.'
                : 'A typed id is accepted when the provider supports custom voices.'}
            </span>
          </label>
        )}

        {!fixedSpeed && (
          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-ink/70">Speed</span>
            <input
              type="number"
              min={spec.speed.min}
              max={spec.speed.max}
              step={0.05}
              value={config.speed}
              onChange={(event) => onPatch({ speed: Number(event.currentTarget.value) })}
              className={INPUT_CLASS}
            />
            <span className="block text-[10px] text-ink/50">
              {spec.speed.min}–{spec.speed.max}; 1 is normal.
            </span>
          </label>
        )}

        {takesLanguageTag && (
          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-ink/70">Language</span>
            <select
              value={config.language || (spec.language === 'required' ? 'auto' : '')}
              onChange={(event) => onPatch({ language: event.currentTarget.value === 'auto' ? '' : event.currentTarget.value })}
              className={INPUT_CLASS}
            >
              {spec.language !== 'required' && <option value="">Auto / detect</option>}
              {TTS_LANGUAGES
                .filter((language) => spec.language === 'required' || language.id !== 'auto')
                .map((language) => (
                  <option key={language.id} value={language.id}>{language.label}</option>
                ))}
            </select>
            <span className="block text-[10px] text-ink/50">
              {spec.language === 'required'
                ? 'This provider requires a language.'
                : spec.language === 'parameter'
                  ? (config.model || spec.defaultModel) === 'eleven_multilingual_v2'
                    ? 'Multilingual v2 detects the language from the text; the newer models receive this as language_code.'
                    : 'Sent as the provider language. “Auto” lets the model detect it.'
                  : 'Only gpt-4o-mini-tts follows this instruction; tts-1 and compatible servers may ignore it.'}
            </span>
          </label>
        )}
      </div>

      {spec.language === 'auto' && (
        <p className="rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2 text-[11px] leading-relaxed text-ink/70">
          Detects the answer’s language automatically — Indonesian is supported.
        </p>
      )}

      {spec.language === 'none' && (
        <p className="rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2 text-[11px] leading-relaxed text-ink/70">
          {spec.id === 'omp'
            ? 'omp’s local voices are English. For Indonesian, pick ElevenLabs, Gemini, xAI, or an OpenAI-compatible server with an Indonesian voice.'
            : 'Deepgram Aura has no Indonesian voice. Pick another engine for Indonesian.'}
        </p>
      )}
    </section>
  );
}
