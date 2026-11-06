/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Add provider" for ONE harness — the typed twin of an import.
 *
 * Everything the form decides is a fact the registry cannot discover by itself:
 * the endpoint, the credential, and (for a registry that needs them) the model
 * ids. Everything else is DERIVED, on purpose:
 *
 *  - **the id** comes from `providerSlugFrom`, the same function the server
 *    validates with, so the key printed under the field is the key that lands —
 *    no "my gateway" saved as `provider-1712345`;
 *  - **the protocol** is left to the probe. A user knows their gateway, rarely
 *    which wire API it answers; the route asks the host and refuses by name when
 *    the target cannot speak the answer (`kenari` declares Chat and works in
 *    claude through Anthropic Messages — measured).
 *
 * There is no protocol picker because a wrong pick is indistinguishable from a
 * working one until the first request; the probe has evidence, a dropdown has an
 * opinion.
 */

import { useState } from 'preact/hooks';
import { Check, Loader2, Plus } from 'lucide-preact';
import type { HarnessImportOutcome, HarnessProviderSupport } from '@/shared/types/harness';
import { providerIdProblem, providerSlugFrom } from '@/shared/lib/harness/provider-slug';

const INPUT_CLASS =
  'w-full rounded-md border border-ink/20 bg-paper px-2 py-1.5 font-mono text-[11px] text-ink outline-none transition-colors placeholder:text-ink/30 focus:border-ink/50';

export interface AddProviderInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  models?: string[];
}

/** Comma- or newline-separated model ids, trimmed and de-duplicated. */
function parseModelIds(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of text.split(/[\n,]+/)) {
    const id = entry.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function AddProviderForm({
  support, onAdd,
}: {
  support: HarnessProviderSupport;
  onAdd: (input: AddProviderInput) => Promise<HarnessImportOutcome>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState('');
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<HarnessImportOutcome | null>(null);

  const id = providerSlugFrom(name);
  const idProblem = name.trim() ? providerIdProblem(id) : null;
  // A registry entry IS its endpoint; an environment harness needs the URL or a
  // key to have anything to write at all.
  const needsUrl = support.level === 'full';
  const canSubmit = Boolean(name.trim()) && !idProblem && !saving
    && (!needsUrl || Boolean(baseUrl.trim()));

  const submit = async () => {
    setSaving(true);
    try {
      const result = await onAdd({
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        ...(models.trim() ? { models: parseModelIds(models) } : {}),
      });
      setOutcome(result);
      if (!result.problem) {
        setName('');
        setBaseUrl('');
        setApiKey('');
        setModels('');
      }
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-ink/20 px-2 py-1 text-[11px] text-ink/70 transition-colors hover:border-ink/40 hover:text-ink"
        >
          <Plus size={11} /> Add provider
        </button>
        {outcome?.problem && (
          <p className="mt-1 text-[10px] text-ink/70">{outcome.problem}</p>
        )}
        {outcome && !outcome.problem && (
          <p className="mt-1 text-[10px] text-ink/55">{outcome.detail ?? 'Added.'}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-ink/15 bg-ink/[0.02] p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/45">Add provider</span>
        <span className="font-mono text-[9px] text-ink/35">
          {support.protocols.length > 0 ? 'protocol measured on save' : 'no provider slot here'}
        </span>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-ink/50">Name</span>
        <input
          type="text"
          value={name}
          placeholder="My Gateway"
          onInput={(e) => setName(e.currentTarget.value)}
          className={INPUT_CLASS}
        />
        {id && (
          <span className="font-mono text-[9px] text-ink/35">
            id: {id}{idProblem ? '' : ` · ${support.pointer ?? 'registry'}`}
          </span>
        )}
        {idProblem && <span className="text-[10px] text-ink/70">{idProblem}</span>}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-ink/50">Base URL</span>
        <input
          type="text"
          value={baseUrl}
          placeholder="https://gateway.example/v1"
          onInput={(e) => setBaseUrl(e.currentTarget.value)}
          className={INPUT_CLASS}
        />
        {support.level === 'environment' && support.env && (
          <span className="font-mono text-[9px] text-ink/35">
            becomes {support.env.baseUrl} — host root, the agent appends its own path
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-ink/50">API key</span>
        <input
          type="password"
          value={apiKey}
          autoComplete="off"
          placeholder="sk-…"
          onInput={(e) => setApiKey(e.currentTarget.value)}
          className={INPUT_CLASS}
        />
        {support.credentialLabel && (
          <span className="font-mono text-[9px] text-ink/35">stored as {support.credentialLabel}</span>
        )}
      </label>

      {support.level === 'full' && (
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink/50">Models</span>
          <input
            type="text"
            value={models}
            placeholder="model-id, another-id"
            onInput={(e) => setModels(e.currentTarget.value)}
            className={INPUT_CLASS}
          />
          <span className="text-[9px] text-ink/35">
            Comma separated. Leave it empty only for an endpoint OVERRIDE of a provider the agent
            already ships — measured: a provider with no models and no discovery serves nothing.
          </span>
        </label>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-ink/20 px-2 py-1 text-[11px] text-ink/75 transition-colors hover:border-ink/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Add
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setOutcome(null); }}
          className="cursor-pointer text-[11px] text-ink/45 hover:text-ink"
        >
          Cancel
        </button>
      </div>

      {outcome && (
        <div className="space-y-0.5">
          <p className={`text-[10px] ${outcome.problem ? 'text-ink/70' : 'text-ink/55'}`}>
            {outcome.problem ?? 'Added.'}
          </p>
          {outcome.detail && <p className="font-mono text-[9px] leading-relaxed text-ink/40">{outcome.detail}</p>}
        </div>
      )}
    </div>
  );
}
