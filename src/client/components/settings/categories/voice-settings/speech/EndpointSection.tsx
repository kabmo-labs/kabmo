/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Endpoint, presets and the write-only API key.
 *
 * The key field is never populated from the server — a GET answers `hasKeys`, so
 * the page can say "a key is stored" without ever holding the value. Saving is
 * an explicit action; clearing removes that engine's entry and leaves the other
 * engines' keys alone.
 *
 * The base URL is editable only for the OpenAI-compatible engine, because the
 * other providers have fixed hosts. Pointing it at Groq or a local Kokoro server
 * is the reason it exists at all.
 */

import { useEffect, useState } from 'preact/hooks';
import { KeyRound, Trash2 } from 'lucide-preact';
import { TTS_PRESETS, ttsEngine, type TtsEngine } from '@/shared/lib/tts/engines';
import type { TtsConfig } from '@/shared/lib/tts/settings';
import { normalizeBaseUrl } from '@/shared/lib/net/base-url';
import { CARD_CLASS, INPUT_CLASS } from '@/client/components/settings/categories/voice-settings/speech/styles';

export interface SpeechEndpointSectionProps {
  config: TtsConfig;
  hasKey: boolean;
  busy: boolean;
  onPatch: (patch: Partial<TtsConfig>) => void;
  onSaveKey: (engine: TtsEngine, apiKey: string) => void;
  onClearKey: (engine: TtsEngine) => void;
}

export function SpeechEndpointSection({
  config,
  hasKey,
  busy,
  onPatch,
  onSaveKey,
  onClearKey,
}: SpeechEndpointSectionProps) {
  const spec = ttsEngine(config.engine);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [apiKey, setApiKey] = useState('');

  useEffect(() => setBaseUrl(config.baseUrl), [config.baseUrl]);

  const baseUrlError = baseUrl.trim() && normalizeBaseUrl(baseUrl) === null
    ? 'That is not an http(s) URL, or it embeds a username/password.'
    : null;

  if (!spec.editableBaseUrl && !spec.needsKey) {
    return (
      <section className="space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-ink">Local engine</h4>
          <p className="mt-0.5 text-[11px] text-ink/60">
            No key and no network. The first run downloads omp's voice; later runs are local.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Endpoint and key</h4>
        <p className="mt-0.5 text-[11px] text-ink/60">
          {spec.needsKey
            ? 'The key is stored outside the settings table, in a file only this server reads.'
            : 'No key is needed.'}
        </p>
      </div>

      {spec.editableBaseUrl && (
        <div className={`${CARD_CLASS} space-y-2`}>
          <div className="flex flex-wrap gap-1.5">
            {TTS_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.note}
                onClick={() => {
                  setBaseUrl(preset.baseUrl);
                  onPatch({ baseUrl: preset.baseUrl, model: preset.model, voice: preset.voice });
                }}
                className="rounded-full border border-ink/15 px-2.5 py-1 text-[10px] text-ink/70 transition-colors hover:border-ink/30 hover:text-ink"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <label className="block space-y-1">
            <span className="block text-[11px] font-medium text-ink/70">Base URL</span>
            <input
              type="url"
              value={baseUrl}
              placeholder={spec.baseUrl}
              onInput={(event) => setBaseUrl(event.currentTarget.value)}
              onBlur={() => onPatch({ baseUrl })}
              className={INPUT_CLASS}
            />
            {baseUrlError && <span className="block text-[10px] text-error">{baseUrlError}</span>}
          </label>
        </div>
      )}

      {spec.needsKey && (
        <div className={`${CARD_CLASS} space-y-2`}>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-ink/70">
              <KeyRound size={12} className="text-ink/50" />
              {hasKey ? 'A key is stored for this engine.' : 'No key stored for this engine.'}
            </span>
            {hasKey && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onClearKey(config.engine)}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-ink/60 transition-colors hover:bg-ink/5 hover:text-error disabled:opacity-50"
              >
                <Trash2 size={11} /> Clear
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              placeholder={hasKey ? 'Replace the stored key…' : 'Paste the API key…'}
              autocomplete="off"
              onInput={(event) => setApiKey(event.currentTarget.value)}
              className={INPUT_CLASS}
            />
            <button
              type="button"
              disabled={busy || !apiKey.trim()}
              onClick={() => {
                onSaveKey(config.engine, apiKey);
                setApiKey('');
              }}
              className="shrink-0 rounded-md border border-ink/20 px-2.5 py-1.5 text-[11px] text-ink transition-colors hover:border-ink/40 disabled:opacity-40"
            >
              Save key
            </button>
          </div>
          <a
            href={spec.docs}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-[10px] text-ink/50 underline decoration-ink/20 hover:text-ink"
          >
            {spec.label} documentation
          </a>
        </div>
      )}
    </section>
  );
}
