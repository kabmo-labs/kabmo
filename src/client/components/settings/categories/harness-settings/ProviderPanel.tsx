/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Providers for one harness, drawn at the level the harness actually supports.
 *
 * The three shapes are not styling: each answers a different question, and
 * presenting one as another is how a settings page starts lying.
 *
 *  - **`full`** — the agent keeps a provider registry. The panel lists what is
 *    importable from elsewhere (`omp models.yml`, another opencode registry) and
 *    what is already configured, and a copy writes a real registry entry.
 *  - **`environment`** — the agent is pointed at ONE endpoint. The fields are
 *    labelled with the environment variable each becomes, and the panel says
 *    plainly that this REPLACES the vendor instead of adding beside it. Adding a
 *    "provider" here would be the page's lie, not the agent's limitation.
 *  - **`configurable`** — no registry Kabmo can write. The panel names the whole
 *    surface (the launch command and its env) and offers nothing, because
 *    offering an editor that writes a file the agent never reads is worse than
 *    saying so.
 *
 * The import rows carry no credentials. Picking one and confirming is what reads
 * the key, from the source file, in the request that writes the target.
 */

import { useState } from 'preact/hooks';
import { AlertCircle, Check, Download, Loader2 } from 'lucide-preact';
import type { HarnessProviderSupport } from '@/shared/types/harness';

interface ProviderPanelProps {
  support: HarnessProviderSupport;
  /** Save env-style providers into this harness's config. */
  onSaveEnv?: (env: string) => Promise<string | null>;
  /** Copy one provider out of a source registry into this harness.
   *
   *  The whole ROW travels, not just its id: the writer needs the endpoint, the
   *  dialect and the model list, and re-reading them server-side would be a
   *  second lookup of something the list already answered. The credential is
   *  still not in the row — the server reads that from the source file. */
  onImport?: (sourceId: string, entry: HarnessProviderSupport['importable'][number]) => Promise<string | null>;
}

const INPUT_CLASS =
  'w-full rounded-md border border-ink/20 bg-paper px-2 py-1.5 font-mono text-[11px] text-ink outline-none transition-colors placeholder:text-ink/30 focus:border-ink/50';

/** One importable row: the source's own name, its models, and its credential state. */
function ImportRow({
  entry, onImport, busy,
}: {
  entry: HarnessProviderSupport['importable'][number];
  onImport: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-ink/5 py-1.5 last:border-0">
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium text-ink">{entry.name}</div>
        <div className="truncate font-mono text-[10px] text-ink/45">
          {entry.id}
          {entry.models.length > 0 ? ` · ${entry.models.length} models` : ' · no models listed'}
          {entry.baseUrl ? ` · ${entry.baseUrl}` : ''}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {/* State, not a key: `hasKey` is the source's boolean and the value never
            reaches the browser. */}
        <span className="text-[10px] text-ink/40">{entry.hasKey ? 'key stored' : 'no key'}</span>
        <button
          type="button"
          onClick={onImport}
          disabled={busy}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-ink/20 px-2 py-0.5 text-[10px] text-ink/70 transition-colors hover:border-ink/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />} Import
        </button>
      </div>
    </div>
  );
}

/** The env-style form: base URL, key, optional model pin. */
function EnvProviderForm({ support, onSave }: { support: HarnessProviderSupport; onSave: (env: string) => Promise<string | null> }) {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const env = support.env;

  if (!env) return null;

  const save = async () => {
    setSaving(true);
    try {
      const lines = [
        baseUrl.trim() ? `${env.baseUrl}=${baseUrl.trim()}` : '',
        apiKey.trim() ? `${env.apiKey}=${apiKey.trim()}` : '',
        env.model && model.trim() ? `${env.model}=${model.trim()}` : '',
      ].filter(Boolean);
      setProblem(await onSave(lines.join('\n')));
      if (!problem) {
        setBaseUrl('');
        setApiKey('');
        setModel('');
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
        <input class={INPUT_CLASS} className={INPUT_CLASS} value={baseUrl}
          placeholder="https://api.example.com" onInput={(e) => setBaseUrl(e.currentTarget.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] text-ink/50">{env.apiKey}</span>
        <input className={INPUT_CLASS} type="password" value={apiKey} autoComplete="off"
          placeholder="sk-…" onInput={(e) => setApiKey(e.currentTarget.value)} />
      </label>
      {env.model && (
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] text-ink/50">{env.model}</span>
          <input className={INPUT_CLASS} value={model} placeholder="claude-sonnet-5"
            onInput={(e) => setModel(e.currentTarget.value)} />
        </label>
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

export function HarnessProviderPanel({ support, onSaveEnv, onImport }: ProviderPanelProps) {
  if (support.level === 'configurable') {
    return (
      <div className="mt-3 space-y-2 border-t border-ink/10 pt-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/45">Providers</span>
        <p className="text-[11px] leading-relaxed text-ink/55">{support.summary}</p>
        <p className="text-[10px] text-ink/40">
          Use the launch command and environment fields above — that is this agent's whole surface.
        </p>
      </div>
    );
  }

  if (support.level === 'environment') {
    return (
      <div className="mt-3 space-y-2 border-t border-ink/10 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/45">Provider</span>
          <span className="font-mono text-[10px] text-ink/40">{support.fileLabel}</span>
        </div>
        <p className="text-[11px] leading-relaxed text-ink/55">{support.summary}</p>
        {onSaveEnv && <EnvProviderForm support={support} onSave={onSaveEnv} />}
      </div>
    );
  }

  // `full`: a real registry, with imports from the sources this harness allows.
  return <FullProviderPanel support={support} onImport={onImport} />;
}

/**
 * The registry-backed panel.
 *
 * A `full` harness whose file Kabmo cannot write yet (`command-code` keeps an
 * undocumented `providers.json` its own `/connect` writes) says exactly that
 * instead of pretending the import list is an editor: the rows are shown as
 * what the source holds, with the action that actually adds one — the agent's
 * own command.
 */
function FullProviderPanel({
  support, onImport,
}: {
  support: HarnessProviderSupport;
  onImport?: (sourceId: string, entry: HarnessProviderSupport['importable'][number]) => Promise<string | null>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ id: string; problem: string | null } | null>(null);

  const importable = support.importable;
  return (
    <div className="mt-3 space-y-2 border-t border-ink/10 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/45">Providers</span>
        <span className="font-mono text-[10px] text-ink/40" title={support.file || undefined}>
          {support.fileLabel}{support.pointer ? ` · ${support.pointer}` : ''}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-ink/55">{support.summary}</p>

      {importable.length === 0 ? (
        <p className="text-[10px] text-ink/40">
          Nothing to import yet — omp's models.yml and the other harness registries are empty or unreadable.
        </p>
      ) : (
        <div>
          <div className="mb-1 text-[10px] font-medium text-ink/50">Import from another registry</div>
          {importable.map((entry) => (
            <ImportRow
              key={`${entry.source}:${entry.id}`}
              entry={entry}
              busy={busyId === entry.id}
              onImport={() => {
                if (!onImport) return;
                setBusyId(entry.id);
                void onImport(entry.id, entry)
                  .then((problem) => setOutcome({ id: entry.id, problem }))
                  .finally(() => setBusyId(null));
              }}
            />
          ))}
          {outcome && (
            <p className={`mt-1 text-[10px] ${outcome.problem ? 'text-ink/70' : 'text-ink/45'}`}>
              {outcome.problem
                ? outcome.problem
                : `Copied into ${support.fileLabel} — restart the agent so it re-reads the file.`}
            </p>
          )}
          {!onImport && (
            <p className="mt-1 text-[10px] text-ink/40">
              This file has no writer in this build; the rows show what the source holds.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
