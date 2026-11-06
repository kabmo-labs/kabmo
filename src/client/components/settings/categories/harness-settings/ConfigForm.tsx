/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The per-harness config form: launch command, env, provider and the defaults a
 * new chat starts on.
 *
 * Every field is OPTIONAL and empty means "the build's default" — stated, not
 * implied, because an empty box that silently overrides something is the same
 * class of bug as a value that silently does nothing. Saving writes the whole
 * config in one request; the card re-renders from the server's answer, so what a
 * user sees afterwards is what the spawn will read.
 *
 * The provider and model pickers read the PROBE, never a constant: an agent's
 * providers are whatever its `configOptions[model]` published, so a provider that
 * has never answered offers a free-text field and says why.
 */

import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Loader2, RotateCcw, Save } from 'lucide-preact';
import {
  EMPTY_HARNESS_CONFIG,
  isHarnessConfigured,
  providerChoices,
  resolveDefaultModel,
  type HarnessConfig,
} from '@/shared/lib/harness/config';
import type { HarnessSummary } from '@/shared/types/harness';

interface HarnessConfigFormProps {
  summary: HarnessSummary;
  config: HarnessConfig;
  onSave: (config: HarnessConfig) => Promise<string | null>;
}

/** One labelled field, with its own hint where the value needs explaining. */
function Field({
  label, hint, children,
}: { label: string; hint: string; children: ComponentChildren }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/45">{label}</span>
      {children}
      <span className="text-[10px] leading-relaxed text-ink/40">{hint}</span>
    </label>
  );
}

const INPUT_CLASS =
  'w-full rounded-md border border-ink/20 bg-paper px-2 py-1.5 font-mono text-[11px] text-ink outline-none transition-colors placeholder:text-ink/30 focus:border-ink/50';

export function HarnessConfigForm({ summary, config, onSave }: HarnessConfigFormProps) {
  const [draft, setDraft] = useState<HarnessConfig>(config);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const models = summary.probe?.models ?? [];
  const providers = providerChoices(models);
  // The model list narrows to the chosen provider, which is what makes the two
  // fields read as one decision instead of two independent ones.
  const modelChoices = draft.provider
    ? models.filter((option) => option.value.startsWith(`${draft.provider}/`))
    : models;
  const fallbackModel = resolveDefaultModel(draft, models);

  const set = (patch: Partial<HarnessConfig>) => setDraft((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      setProblem(await onSave(draft));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 border-t border-ink/10 pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/45">Configuration</span>
        <div className="flex items-center gap-1.5">
          {isHarnessConfigured(draft) && (
            <button
              type="button"
              onClick={() => setDraft({ ...EMPTY_HARNESS_CONFIG })}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-ink/15 px-2 py-1 text-[11px] text-ink/60 transition-colors hover:border-ink/35 hover:text-ink"
            >
              <RotateCcw size={11} /> Reset
            </button>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-ink/20 px-2 py-1 text-[11px] text-ink/75 transition-colors hover:border-ink/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Launch command"
          hint="Empty uses the built-in line. Quoted paths survive: /Users/me/bin/agy acp"
        >
          <input
            type="text"
            value={draft.command}
            placeholder="agy acp"
            onInput={(event) => set({ command: event.currentTarget.value })}
            className={INPUT_CLASS}
          />
        </Field>

        <Field
          label="Provider"
          hint={
            providers.length > 0
              ? `Published by this agent: ${providers.slice(0, 4).join(', ')}${providers.length > 4 ? '…' : ''}`
              : 'Not known yet — probe the harness to list its providers'
          }
        >
          {providers.length > 0 ? (
            <select
              value={draft.provider}
              onChange={(event) => set({ provider: event.currentTarget.value, model: '' })}
              className={INPUT_CLASS}
            >
              <option value="">Agent default</option>
              {providers.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={draft.provider}
              placeholder="command-code"
              onInput={(event) => set({ provider: event.currentTarget.value })}
              className={INPUT_CLASS}
            />
          )}
        </Field>

        <Field
          label="Default model"
          hint={
            draft.model
              ? 'Applied after session/new'
              : fallbackModel
                ? `Falls back to ${fallbackModel}`
                : 'Empty leaves the agent on its own default'
          }
        >
          {modelChoices.length > 0 ? (
            <select
              value={draft.model}
              onChange={(event) => set({ model: event.currentTarget.value })}
              className={INPUT_CLASS}
            >
              <option value="">Agent default</option>
              {modelChoices.map((option) => (
                <option key={option.value} value={option.value}>{option.name || option.value}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={draft.model}
              placeholder="provider/model"
              onInput={(event) => set({ model: event.currentTarget.value })}
              className={INPUT_CLASS}
            />
          )}
        </Field>

        <Field label="Default thinking" hint="Empty leaves the agent on its own effort">
          {summary.probe?.thinking.length ? (
            <select
              value={draft.thinking}
              onChange={(event) => set({ thinking: event.currentTarget.value })}
              className={INPUT_CLASS}
            >
              <option value="">Agent default</option>
              {summary.probe.thinking.map((option) => (
                <option key={option.value} value={option.value}>{option.name || option.value}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={draft.thinking}
              placeholder="high"
              onInput={(event) => set({ thinking: event.currentTarget.value })}
              className={INPUT_CLASS}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Default mode" hint="Empty leaves the agent on its own mode">
          {summary.probe?.modes.length ? (
            <select
              value={draft.mode}
              onChange={(event) => set({ mode: event.currentTarget.value })}
              className={INPUT_CLASS}
            >
              <option value="">Agent default</option>
              {summary.probe.modes.map((option) => (
                <option key={option.value} value={option.value}>{option.name || option.value}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={draft.mode}
              placeholder="plan"
              onInput={(event) => set({ mode: event.currentTarget.value })}
              className={INPUT_CLASS}
            />
          )}
        </Field>

        <Field
          label="Environment"
          hint="One KEY=VALUE per line. This is the provider/credential switch an ACP agent actually honours."
        >
          <textarea
            value={draft.env}
            rows={3}
            placeholder={'GEMINI_API_KEY=…\nGOOGLE_GEMINI_BASE_URL=https://…'}
            onInput={(event) => set({ env: event.currentTarget.value })}
            className={`${INPUT_CLASS} resize-y`}
          />
        </Field>
      </div>

      {problem && (
        <div className="rounded-lg border border-ink/15 bg-ink/[0.04] p-2 text-[11px] text-ink/75">{problem}</div>
      )}
    </div>
  );
}
