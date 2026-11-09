/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The env-style provider form: one endpoint, its key, and an optional model pin.
 *
 * This is the entire "add a provider" action for an `environment` harness (Claude
 * Code, Antigravity). Every field is labelled with the VARIABLE it becomes,
 * because that is the only thing the user's choice produces — there is no
 * registry to add to.
 *
 * A blank field writes NO variable: an empty env var is a real thing to set, so
 * the form must not do it by accident. And the answer of `onSave` — not a state
 * read after `setProblem` — decides whether the fields clear: the previous
 * version read the stale state, so a successful save reported failure and kept
 * its values.
 */

import { useState } from 'preact/hooks';
import { AlertCircle, Check, Loader2 } from 'lucide-preact';
import type { HarnessProviderSupport } from '@/shared/types/harness';

const INPUT_CLASS =
  'w-full rounded-md border border-ink/20 bg-paper px-2 py-1.5 font-mono text-[11px] text-ink outline-none transition-colors placeholder:text-ink/30 focus:border-ink/50';

export function EnvProviderForm({ support, onSave }: { support: HarnessProviderSupport; onSave: (env: string) => Promise<string | null> }) {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  /** One value per `ANTHROPIC_DEFAULT_*_MODEL`-style variable, keyed by name. */
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const env = support.env;

  if (!env) return null;

  const modelAliases = env.modelAliases ?? [];

  const save = async () => {
    setSaving(true);
    try {
      const written = [
        baseUrl.trim() ? `${env.baseUrl}=${baseUrl.trim()}` : '',
        apiKey.trim() ? `${env.apiKey}=${apiKey.trim()}` : '',
        env.model && model.trim() ? `${env.model}=${model.trim()}` : '',
        ...modelAliases.map((alias) => {
          const value = aliases[alias.env]?.trim();
          return value ? `${alias.env}=${value}` : '';
        }),
      ].filter(Boolean).join('\n');
      // The ANSWER is what decides success. Reading the `problem` state here held
      // the PREVIOUS save's value, so a successful save reported failure.
      const refusal = await onSave(written);
      setProblem(refusal);
      if (!refusal) {
        setBaseUrl('');
        setApiKey('');
        setModel('');
        setAliases({});
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-1.5 rounded-md border border-ink/15 bg-ink/[0.03] p-2 text-[10px] leading-relaxed text-ink/65">
        <AlertCircle size={11} className="mt-0.5 shrink-0" />
        <span>
          These point <strong className="font-semibold text-ink">every</strong> request at one endpoint — they
          replace this agent's own provider, they do not add beside it.
        </span>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] text-ink/50">{env.baseUrl}</span>
        <input
          type="text"
          value={baseUrl}
          placeholder="https://api.example.com"
          onInput={(e) => setBaseUrl(e.currentTarget.value)}
          className={INPUT_CLASS}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] text-ink/50">{env.apiKey}</span>
        <input
          type="password"
          value={apiKey}
          autoComplete="off"
          placeholder="sk-…"
          onInput={(e) => setApiKey(e.currentTarget.value)}
          className={INPUT_CLASS}
        />
      </label>
      {env.model && (
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] text-ink/50">{env.model}</span>
          <input
            type="text"
            value={model}
            placeholder="claude-sonnet-5"
            onInput={(e) => setModel(e.currentTarget.value)}
            className={INPUT_CLASS}
          />
        </label>
      )}
      {modelAliases.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-ink/15 bg-ink/[0.03] p-2">
          <div className="text-[10px] leading-relaxed text-ink/60">
            Each picker alias resolves to a model id the vendor ships unless it is pinned here.
            Leave an alias blank when the endpoint serves that family's vendor id; fill it when
            the endpoint has its own ids — otherwise that pick sends
            {' '}<span className="font-mono">400 model not found</span>.
          </div>
          {modelAliases.map((alias) => (
            <label key={alias.env} className="flex flex-col gap-1">
              <span className="font-mono text-[10px] text-ink/50">{alias.env}</span>
              <input
                type="text"
                value={aliases[alias.env] ?? ''}
                placeholder={`the endpoint's ${alias.family} model id`}
                onInput={(e) => setAliases((prev) => ({ ...prev, [alias.env]: e.currentTarget.value }))}
                className={INPUT_CLASS}
              />
            </label>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || (!baseUrl.trim() && !apiKey.trim())}
        className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-ink/20 px-2 py-1 text-[11px] text-ink/75 transition-colors hover:border-ink/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save to environment
      </button>
      {problem && <div className="rounded-md border border-ink/15 bg-ink/[0.04] p-2 text-[11px] text-ink/75">{problem}</div>}
    </div>
  );
}
