/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The rows of "import a custom provider from another harness".
 *
 * Split from the panel so the registry card and the environment card draw the
 * SAME list: one row shape, one refusal rendering, one evidence block. A second
 * copy is how the two surfaces start disagreeing about what a provider is.
 *
 * A row states the source's declared protocol and what THIS agent accepts — and
 * deliberately NOT a verdict, because whether an endpoint can land here is a fact
 * about the HOST that only the import's probe has. Measured: `kenari` declares
 * Chat Completions and works in Claude Code through Anthropic Messages.
 */

import { useState } from 'preact/hooks';
import { Download, Loader2 } from 'lucide-preact';
import type { HarnessImportOutcome, HarnessProviderSupport } from '@/shared/types/harness';
import { PROTOCOL_LABELS } from '@/shared/lib/harness/dialects';

export type ImportRow = HarnessProviderSupport['importable'][number];

/** What the row's source declares, and what this agent can take. */
function targetLabel(entry: ImportRow, support: HarnessProviderSupport): string {
  const source = entry.protocol ? PROTOCOL_LABELS[entry.protocol] : entry.dialect ?? 'unknown dialect';
  if (support.protocols.length === 0) return `${source} — this agent takes no providers`;
  return `${source} · this agent takes ${support.protocols.map((p) => PROTOCOL_LABELS[p]).join(' · ')}`;
}

/** One importable row: the source's own name, its models, and its credential state. */
function ImportRowView({
  entry, support, onImport, busy,
}: {
  entry: ImportRow;
  support: HarnessProviderSupport;
  onImport: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-ink/5 py-1.5 last:border-0">
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium text-ink">
          {entry.name}
          <span className="ml-1.5 font-mono text-[9px] uppercase tracking-wider text-ink/35">{entry.source}</span>
        </div>
        <div className="truncate font-mono text-[10px] text-ink/45">
          {entry.id}
          {entry.models.length > 0 ? ` · ${entry.models.length} models` : ' · no models listed'}
          {entry.baseUrl ? ` · ${entry.baseUrl}` : ''}
        </div>
        <div className="truncate text-[10px] text-ink/40">{targetLabel(entry, support)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {/* State, not a key: `hasKey` is the source's boolean and the value never
            reaches the browser. */}
        <span className="text-[10px] text-ink/40">{entry.hasKey ? 'key stored' : 'no key'}</span>
        <button
          type="button"
          onClick={onImport}
          disabled={busy}
          title="Probes the endpoint, picks a protocol this agent speaks, and copies the credential from the source"
          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-ink/20 px-2 py-0.5 text-[10px] text-ink/70 transition-colors hover:border-ink/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />} Import
        </button>
      </div>
    </div>
  );
}

export function ImportSection({
  support, onImport,
}: {
  support: HarnessProviderSupport;
  onImport: (sourceId: string, entry: ImportRow) => Promise<HarnessImportOutcome>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ id: string; result: HarnessImportOutcome } | null>(null);
  const importable = support.importable;

  if (importable.length === 0) return null;

  return (
    <div className="mt-3 space-y-1 border-t border-ink/10 pt-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-ink/50">Import from another harness</span>
        <span className="text-[10px] text-ink/35">{importable.length} custom</span>
      </div>
      {importable.map((entry) => (
        <ImportRowView
          key={`${entry.source}:${entry.id}`}
          entry={entry}
          support={support}
          busy={busyId === entry.id}
          onImport={() => {
            setBusyId(entry.id);
            void onImport(entry.id, entry)
              .then((result) => setOutcome({ id: entry.id, result }))
              .finally(() => setBusyId(null));
          }}
        />
      ))}
      {outcome && (
        <div className="mt-1 space-y-0.5">
          <p className={`text-[10px] ${outcome.result.problem ? 'text-ink/70' : 'text-ink/55'}`}>
            {outcome.result.problem
              ? outcome.result.problem
              : `Copied ${outcome.id} into ${support.fileLabel} — restart the agent so it re-reads the file.`}
          </p>
          {/* The evidence, not a bare "copied": which protocol the probe chose and
              which variables were set are the facts a reader can check. */}
          {outcome.result.detail && (
            <p className="font-mono text-[9px] leading-relaxed text-ink/40">{outcome.result.detail}</p>
          )}
        </div>
      )}
      <p className="text-[10px] text-ink/35">
        Only providers you registered yourself can be copied; a provider the agent ships is its own.
      </p>
    </div>
  );
}

/**
 * What this harness ALREADY holds, from its own registry.
 *
 * Without it an Add that wrote correctly and an Add that silently wrote nothing
 * render the same card — the reason the import list alone was not enough. Rows
 * are the custom ones only, because a vendor entry with an endpoint override is
 * the agent's own provider rather than something Kabmo added.
 */
export function ConfiguredList({ support }: { support: HarnessProviderSupport }) {
  const configured = support.configured;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-ink/50">In this agent's registry</span>
        <span className="text-[10px] text-ink/35">{configured.length} custom</span>
      </div>
      {configured.length === 0 ? (
        <p className="text-[10px] text-ink/40">
          No provider of your own yet. Add one below, or copy one from another harness.
        </p>
      ) : (
        configured.map((entry) => (
          <div key={entry.id} className="flex items-center justify-between gap-2 border-b border-ink/5 py-1.5 last:border-0">
            <div className="min-w-0">
              <div className="truncate text-[11px] font-medium text-ink">{entry.name}</div>
              <div className="truncate font-mono text-[10px] text-ink/45">
                {entry.id}
                {entry.models.length > 0 ? ` · ${entry.models.length} models` : ' · no models listed'}
                {entry.baseUrl ? ` · ${entry.baseUrl}` : ''}
              </div>
              <div className="truncate text-[10px] text-ink/40">{targetLabel(entry, support)}</div>
            </div>
            <span className="shrink-0 text-[10px] text-ink/40">{entry.hasKey ? 'key stored' : 'no key'}</span>
          </div>
        ))
      )}
    </div>
  );
}

/**
 * The same rows with the action unavailable — a registry Kabmo may READ but has
 * no writer for (`command-code` keeps its own `providers.json`).
 */
export function ReadOnlyRows({ support }: { support: HarnessProviderSupport }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium text-ink/50">Import from another harness</div>
      {support.importable.map((entry) => (
        <div key={`${entry.source}:${entry.id}`} className="border-b border-ink/5 py-1.5 last:border-0">
          <div className="truncate text-[11px] font-medium text-ink">
            {entry.name}
            <span className="ml-1.5 font-mono text-[9px] uppercase tracking-wider text-ink/35">{entry.source}</span>
          </div>
          <div className="truncate font-mono text-[10px] text-ink/45">
            {entry.id}
            {entry.models.length > 0 ? ` · ${entry.models.length} models` : ' · no models listed'}
            {entry.baseUrl ? ` · ${entry.baseUrl}` : ''}
          </div>
          <div className="truncate text-[10px] text-ink/40">{targetLabel(entry, support)}</div>
          <div className="text-[10px] text-ink/35">{entry.hasKey ? 'key stored' : 'no key'}</div>
        </div>
      ))}
      <p className="text-[10px] text-ink/40">
        This file has no writer in this build; the rows show what the sources hold.
      </p>
    </div>
  );
}
