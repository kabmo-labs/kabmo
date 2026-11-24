/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The external endpoint: base URL with one-click presets, model, the write-only
 * API key, and the vocabulary hint.
 *
 * The key field is never populated from the server — a GET answers `hasApiKey`,
 * so the page can say "a key is stored" without ever holding the value. Saving
 * is an explicit action; clearing removes the file.
 *
 * The base URL is editable only for the [OI]-compatible engine, because the other
 * two providers have fixed hosts. Pointing it at a local whisper.cpp server is
 * the reason it exists at all, and it is the one field where a typo must be
 * visible: the server refuses anything that is not http(s) or that embeds
 * credentials, and that refusal is shown here.
 */

import { useEffect, useState } from 'preact/hooks';
import { KeyRound, Trash2 } from 'lucide-preact';
import {
  DICTATION_PRESETS,
  dictationEngine,
  resolveDictationModel,
} from '@/shared/lib/dictation/engines';
import { normalizeBaseUrl, type DictationConfig } from '@/shared/lib/dictation/settings';

const INPUT_CLASS =
  'w-full rounded-md border border-ink/20 bg-paper px-2 py-1.5 font-mono text-[11px] text-ink outline-none transition-colors placeholder:text-ink/30 focus:border-ink/50';

export interface ExternalSectionProps {
  config: DictationConfig;
  hasApiKey: boolean;
  busy: boolean;
  onPatch: (patch: Partial<DictationConfig>) => void;
  onSaveKey: (apiKey: string) => void;
  onClearKey: () => void;
}

export function ExternalSection({
  config,
  hasApiKey,
  busy,
  onPatch,
  onSaveKey,
  onClearKey,
}: ExternalSectionProps) {
  const spec = dictationEngine(config.engine);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [model, setModel] = useState(config.model);
  const [prompt, setPrompt] = useState(config.prompt);
  const [apiKey, setApiKey] = useState('');

  // A preset, an engine switch or a save rewrites the effective values; the
  // fields follow them instead of keeping a value the server is not using.
  useEffect(() => setBaseUrl(config.baseUrl), [config.baseUrl]);
  useEffect(() => setModel(config.model), [config.model]);
  useEffect(() => setPrompt(config.prompt), [config.prompt]);

  const baseUrlError =
    baseUrl.trim() && normalizeBaseUrl(baseUrl) === null
      ? 'That is not an http(s) URL, or it embeds a username/password.'
      : null;

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Endpoint and model</h4>
        <p className="mt-0.5 text-[11px] text-ink/60">
          {spec.needsKey
            ? 'A key is required. It is stored outside the settings table, in a file only this server reads.'
            : 'The local engine needs no key and no network.'}
          {spec.docs && (
            <>
              {' '}
              <a
                href={spec.docs}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-ink/30 underline-offset-2 hover:text-ink"
              >
                API reference
              </a>
            </>
          )}
        </p>
      </div>

      {spec.editableBaseUrl && (
        <div className="space-y-2 rounded-lg border border-ink/15 bg-paper px-3.5 py-3">
          <div className="flex flex-wrap gap-1.5">
            {DICTATION_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.note}
                onClick={() => {
                  setBaseUrl(preset.baseUrl);
                  setModel(preset.model);
                  onPatch({ baseUrl: preset.baseUrl, model: preset.model });
                }}
                className="rounded-md border border-ink/20 px-2 py-1 text-[11px] text-ink/75 transition-colors hover:bg-ink/5 hover:text-ink"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-ink/50">Base URL</span>
            <input
              type="text"
              value={baseUrl}
              spellcheck={false}
              placeholder={spec.baseUrl}
              onInput={(event) => setBaseUrl(event.currentTarget.value)}
              onBlur={() => {
                const trimmed = baseUrl.trim();
                if (trimmed !== config.baseUrl) onPatch({ baseUrl: trimmed });
              }}
              className={INPUT_CLASS}
            />
          </label>
          {baseUrlError && <p className="text-[11px] text-error">{baseUrlError}</p>}
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-ink/15 bg-paper px-3.5 py-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink/50">Model</span>
          <input
            type="text"
            value={model}
            spellcheck={false}
            list="dictation-models"
            placeholder={spec.defaultModel}
            onInput={(event) => setModel(event.currentTarget.value)}
            onBlur={() => {
              const trimmed = model.trim();
              if (trimmed !== config.model) onPatch({ model: trimmed });
            }}
            className={INPUT_CLASS}
          />
          <datalist id="dictation-models">
            {spec.models.map((option) => (
              <option key={option.id} value={option.id}>
                {option.hint}
              </option>
            ))}
          </datalist>
          <span className="text-[11px] text-ink/50">
            Empty uses {spec.label}'s default ({resolveDictationModel(config.engine, '')}).
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink/50">Vocabulary hint (optional)</span>
          <input
            type="text"
            value={prompt}
            placeholder="Project names, jargon, acronyms"
            onInput={(event) => setPrompt(event.currentTarget.value)}
            onBlur={() => {
              if (prompt !== config.prompt) onPatch({ prompt });
            }}
            className={INPUT_CLASS}
          />
          <span className="text-[11px] text-ink/50">
            Sent as the transcription prompt so unusual words are spelled as you write them. Ignored
            by Deepgram and ElevenLabs.
          </span>
        </label>

        {spec.needsKey && (
          <div className="space-y-1.5 border-t border-ink/10 pt-2.5">
            <span className="flex items-center gap-1.5 text-[10px] text-ink/50">
              <KeyRound size={11} />
              API key {hasApiKey ? '— a key is stored' : '— none stored'}
            </span>
            <div className="flex gap-1.5">
              <input
                type="password"
                value={apiKey}
                autocomplete="off"
                spellcheck={false}
                placeholder={hasApiKey ? 'Replace the stored key' : 'Paste the key'}
                onInput={(event) => setApiKey(event.currentTarget.value)}
                className={INPUT_CLASS}
              />
              <button
                type="button"
                disabled={busy || !apiKey.trim()}
                onClick={() => {
                  onSaveKey(apiKey.trim());
                  setApiKey('');
                }}
                className="shrink-0 rounded-md bg-ink px-2.5 py-1 text-[11px] font-medium text-paper transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save
              </button>
              {hasApiKey && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onClearKey}
                  title="Remove the stored key"
                  className="shrink-0 rounded-md border border-ink/20 px-2 py-1 text-ink/70 transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-40"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
