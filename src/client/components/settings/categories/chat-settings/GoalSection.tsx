/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Goal-mode settings: who audits a goal, and what a new goal starts with.
 *
 * These are the loop's own knobs rather than a session's — a goal is the one
 * feature that keeps spending tokens while nobody is watching, so the auditor
 * has to be visible and switchable. The composer's dialog owns the OBJECTIVE;
 * this section owns the defaults it opens with.
 */

import { useEffect, useState } from 'preact/hooks';
import { Check, Coins, ShieldCheck, Target } from 'lucide-preact';
import type { AIModelOption, SettingsState } from '@/shared/types';
import { fetchModelsData } from '@/shared/lib/models/client';
import { modelKey } from '@/shared/lib/models/identity';
import { providerLabel } from '@/shared/lib/models/provider/label';
import { useProviderNames } from '@/client/hooks/models/use-provider-names';
import { normalizeGoalBudget } from '@/shared/lib/omp/mode/budget';

interface ChatGoalSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

const AUDIT_OPTIONS: Array<{ enabled: boolean; label: string; badge: string; description: string; note: string }> = [
  {
    enabled: true,
    label: 'Independent auditor',
    badge: 'Default',
    description:
      'After every finished turn a separate model reads the objective and the agent\'s own report and decides: keep going, done, or needs you. Without it nothing advances a goal on its own.',
    note: 'One extra model call per turn',
  },
  {
    enabled: false,
    label: 'Manual only',
    badge: 'Opt-out',
    description:
      'Goals still exist — objective, pause, resume and the token budget all work — but the loop never continues by itself. Use it when a goal should only ever run the turns you ask for.',
    note: 'No background model calls',
  },
];

export function ChatGoalSection({ settings, onUpdate }: ChatGoalSectionProps) {
  const providerNames = useProviderNames();
  const [models, setModels] = useState<AIModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const auditEnabled = settings.goalAuditEnabled ?? true;
  const auditModel = settings.goalAuditModel ?? '';
  const budget = settings.goalDefaultBudget ?? null;
  const [budgetText, setBudgetText] = useState(budget === null ? '' : String(budget));

  // The stored value can change from another tab; adopt it only while this
  // field is not the one being typed into.
  useEffect(() => {
    setBudgetText(budget === null ? '' : String(budget));
  }, [budget]);

  const commitBudget = () => {
    const next = normalizeGoalBudget(budgetText);
    setBudgetText(next === null ? '' : String(next));
    if (next !== budget) onUpdate({ goalDefaultBudget: next });
  };

  // The catalog comes from the same `/api/models` the composer uses, so the
  // list here cannot offer a model the picker would not.
  useEffect(() => {
    let active = true;
    fetchModelsData()
      .then((data) => {
        if (!active) return;
        setModels(Array.isArray(data.modelList) ? data.modelList.map((m) => ({ id: m.id, name: m.name, provider: m.provider })) : []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Goal Mode</h4>
        <p className="text-[11px] text-ink/60 mt-0.5">
          A goal keeps a session working toward one objective until it is done, out of budget, or the auditor says it needs you.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {AUDIT_OPTIONS.map(({ enabled, label, badge, description, note }) => {
          const selected = auditEnabled === enabled;
          const select = () => onUpdate({ goalAuditEnabled: enabled });
          return (
            <div
              key={label}
              onClick={select}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && select()}
              className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between select-none ${
                selected ? 'border-ink bg-ink/5 ring-1 ring-ink/20 shadow-xs' : 'border-ink/15 bg-paper hover:border-ink/30 hover:bg-ink/[0.02]'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center ${selected ? 'bg-ink text-paper' : 'bg-ink/5 text-ink/70'}`}>
                      <ShieldCheck size={15} />
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

      {auditEnabled && (
        <div className="rounded-lg border border-ink/15 bg-paper p-3.5 space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/45">Auditor model</label>
            <select
              value={auditModel}
              onChange={(event) => onUpdate({ goalAuditModel: event.currentTarget.value })}
              disabled={loading}
              aria-label="Auditor model"
              className="w-full rounded border border-ink/15 bg-paper px-2 py-1.5 font-mono text-[11.5px] outline-none focus:border-ink disabled:opacity-50"
            >
              {/* The session's own model is the default, not a fallback the UI
                  hides: a goal runs on the provider the chat runs on unless the
                  operator says otherwise. */}
              <option value="">Session model (default)</option>
              {models.map((model) => (
                <option key={modelKey(model)} value={`${model.provider}/${model.id}`}>
                  {model.name} — {providerLabel(model.provider, providerNames)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10.5px] text-ink/45">
              The audit is a classification, not a task: it runs with thinking off, one small call per turn.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-ink/15 bg-paper p-3.5">
        <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink/45">
          <Coins size={11} /> Default token budget
        </label>
        <div className="flex items-center gap-2">
          {/* The field keeps its own text and commits on blur: normalizing on
              every keystroke would blank the input the moment a value is
              half-typed (and "1.5" is a typo, not a budget). */}
          <input
            value={budgetText}
            onChange={(event) => setBudgetText(event.currentTarget.value)}
            onBlur={commitBudget}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitBudget();
            }}
            placeholder="none — the turn ceiling is then the only stop"
            inputMode="numeric"
            aria-label="Default goal token budget"
            className="w-56 rounded border border-ink/15 bg-paper px-2 py-1.5 font-mono text-[11.5px] outline-none focus:border-ink"
          />
          <span className="text-[10.5px] text-ink/45">New goals start with this budget; a goal you set explicitly keeps its own.</span>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-ink/10 bg-canvas/40 p-3 text-[11px] text-ink/60">
        <Target size={12} className="mt-0.5 shrink-0" />
        <span>
          The objective is set per goal from the composer's target button. The auditor judges progress from the objective and the
          agent's own report only — write an objective that says what finished looks like.
        </span>
      </div>
    </section>
  );
}
