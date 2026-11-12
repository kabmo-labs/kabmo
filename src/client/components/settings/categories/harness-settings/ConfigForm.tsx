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
 * WHICH fields appear is per harness, from `config-fields.ts`. The form used to
 * draw the same six for all of them, and the differences are measured, not
 * stylistic: `omp-acp` publishes `kenari/claude-sonnet-5` (a provider dimension),
 * while `claude` publishes `default`, `opus`, `sonnet`, `haiku` — bare names with
 * no provider at all, so its Provider field could never fill and its model list
 * never narrowed. Claude Code's real provider switch is `ANTHROPIC_BASE_URL`, in
 * the Environment box whose hint used to talk about `GEMINI_API_KEY`.
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
import { SearchSelect } from '@/client/components/common/search-select';
import { configFieldPlan } from '@/shared/lib/harness/config-fields';

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
  const plan = configFieldPlan(summary.id as never, summary.probe ?? undefined, {
    ...(draft.provider ? { provider: draft.provider } : {}),
    ...(summary.command ? { launchCommand: summary.command } : {}),
  });
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

      {plan.notes.length > 0 && (
        <ul className="space-y-0.5">
          {plan.notes.map((note) => (
            <li key={note} className="text-[10px] leading-relaxed text-ink/45">{note}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Launch command" hint={plan.launchHint}>
          <input
            type="text"
            value={draft.command}
            placeholder={plan.launchPlaceholder}
            onInput={(event) => set({ command: event.currentTarget.value })}
            className={INPUT_CLASS}
          />
        </Field>

        {plan.showProvider && (
          <Field
            label="Provider"
            hint={
              providers.length > 0
                ? `Published by this agent: ${providers.slice(0, 4).join(', ')}${providers.length > 4 ? '…' : ''}`
                : 'Not known yet — probe the harness to list its providers'
            }
          >
            {providers.length > 0 ? (
              <SearchSelect
                value={draft.provider}
                // Changing the provider clears the model: a model from the previous
                // provider would be written into a selector this agent cannot resolve.
                onChange={(provider) => set({ provider, model: '' })}
                placeholder="Agent default"
                ariaLabel="Provider"
                className={INPUT_CLASS}
                options={providers.map((provider) => ({ value: provider, label: provider }))}
              />
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
        )}

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
            <SearchSelect
              value={draft.model}
              onChange={(model) => set({ model })}
              placeholder="Agent default"
              ariaLabel="Default model"
              className={INPUT_CLASS}
              // An agent publishes up to 221 models (omp, measured), so this list
              // is why the control is searchable at all. Rows are keyed by the
              // stored value; the label is what the agent calls the model.
              options={modelChoices.map((option) => ({
                value: option.value,
                label: option.name || option.value,
                hint: option.value,
              }))}
            />
          ) : (
            <input
              type="text"
              value={draft.model}
              // Not every agent speaks selectors: measured, `omp-acp` publishes
              // `kenari/claude-sonnet-5` while `claude` publishes `opus`/`sonnet`.
              // A `provider/model` placeholder there described a shape that agent
              // never accepts.
              placeholder={plan.modelsAreSelectors ? 'provider/model' : 'model name the agent accepts'}
              onInput={(event) => set({ model: event.currentTarget.value })}
              className={INPUT_CLASS}
            />
          )}
        </Field>

        {plan.showThinking && (
          <Field
            label="Default thinking"
            hint={`This agent publishes ${summary.probe?.thinking.length ?? 0} levels`}
          >
            <SearchSelect
              value={draft.thinking}
              onChange={(thinking) => set({ thinking })}
              placeholder="Agent default"
              ariaLabel="Default thinking"
              className={INPUT_CLASS}
              options={(summary.probe?.thinking ?? []).map((option) => ({
                value: option.value,
                label: option.name || option.value,
              }))}
            />
          </Field>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {plan.showMode && (
          <Field
            label="Default mode"
            hint={`This agent publishes ${summary.probe?.modes.length ?? 0} modes`}
          >
            <SearchSelect
              value={draft.mode}
              onChange={(mode) => set({ mode })}
              placeholder="Agent default"
              ariaLabel="Default mode"
              className={INPUT_CLASS}
              options={(summary.probe?.modes ?? []).map((option) => ({
                value: option.value,
                label: option.name || option.value,
              }))}
            />
          </Field>
        )}

        <Field label="Environment" hint={plan.envHint}>
          <textarea
            value={draft.env}
            rows={3}
            // The example is the agent's OWN contract: `GEMINI_API_KEY` in a
            // Claude Code card is an instruction that cannot work.
            placeholder={plan.envPlaceholder}
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
