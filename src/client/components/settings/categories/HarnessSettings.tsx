/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Harnesses: one section per agent Kabmo can drive.
 *
 * The shape mirrors `OmpSettings`, because the two answer the same kind of
 * question — "what is this engine and what can it do?" — and a second layout for
 * the same job is how one page stops matching the other.
 *
 * What this page owns:
 *  - the catalog and each harness's live status (`/api/harness`),
 *  - the per-harness probe, which spawns that agent once and reads its
 *    `configOptions` (the only way to know which models it offers),
 *  - the install/auth hint, in the agent's own words.
 *
 * What it deliberately does NOT own: omp's own settings. Those live under OMP
 * Engine and Providers and are omp-specific; duplicating them here would be two
 * write paths for one config file.
 */

import { useMemo, useState } from 'preact/hooks';
import { AlertCircle, RefreshCw } from 'lucide-preact';
import { useHarnesses } from '@/client/hooks/models/use-harnesses';
import { HarnessCard } from '@/client/components/settings/categories/harness-settings/HarnessCard';
import { SettingsSearchField } from '@/client/components/settings/categories/harness-settings/parts';

interface HarnessSettingsProps {
  /**
   * Render ONE harness instead of the overview.
   *
   * A harness has its own menu entry, and the card it draws is the same one the
   * overview uses — a second renderer for a single agent is how the two views
   * start disagreeing about what that agent can do.
   */
  only?: string;
}

export function HarnessSettings({ only }: HarnessSettingsProps = {}) {
  const {
    harnesses, configs, providerSupport, isLoading, error, reload, probe, saveConfig, importProvider, addProvider,
  } = useHarnesses();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    // The built-in transport is NOT listed: `omp` over RPC is the default every
    // discovered session already runs on, with nothing to install, probe or
    // configure — its card could only say "no launch command is configured"
    // beside a Check status button that could never succeed. It stays in the
    // catalog because a session row still names the transport that ran it.
    const installable = harnesses.filter((entry) => !entry.builtIn);
    // A single-harness page is not a search surface: it shows the one agent the
    // menu names, and nothing else can match.
    if (only) return installable.filter((entry) => entry.id === only);
    const needle = query.trim().toLowerCase();
    if (!needle) return installable;
    return installable.filter((entry) =>
      entry.label.toLowerCase().includes(needle)
      || entry.id.includes(needle)
      || (entry.note ?? '').toLowerCase().includes(needle),
    );
  }, [harnesses, query, only]);

  const installable = harnesses.filter((entry) => !entry.builtIn);
  const ready = installable.filter((entry) => entry.probe && !entry.probe.capabilities.blocked).length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">
            {only ? (harnesses.find((entry) => entry.id === only)?.label ?? only) : 'Harnesses'}
          </h2>
          <p className="mt-0.5 text-xs text-ink/50">
            {only
              ? 'Providers, launch command, and the defaults a new chat on this agent starts on.'
              : 'Every coding agent Kabmo can run a chat on. The probe asks the agent itself — it spawns once and reports the models, thinking levels and session features it publishes.'}
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-ink/20 px-2.5 py-1.5 text-[11px] text-ink/70 transition-colors hover:border-ink/40 hover:text-ink"
        >
          <RefreshCw size={12} /> Reload catalog
        </button>
      </header>

      {/* The overview counts; a single-harness page has one row and needs no
          search field or tally. */}
      {!only && (
        <div className="flex flex-wrap items-center gap-3">
          <SettingsSearchField value={query} onChange={setQuery} placeholder="Search harnesses" />
          <span className="text-[11px] text-ink/45">
            {installable.length} harnesses · {ready} probed ready
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-ink/15 bg-ink/[0.03] p-3 text-[11px] text-ink/70">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isLoading && harnesses.length === 0 ? (
        <div className="rounded-xl border border-ink/10 p-6 text-center text-xs text-ink/40">Reading the harness catalog…</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((summary) => (
            <HarnessCard
              key={summary.id}
              summary={summary}
              onProbe={probe}
              install={summary.install}
              config={configs[summary.id]}
              onSaveConfig={saveConfig}
              {...(providerSupport[summary.id] ? { providerSupport: providerSupport[summary.id] } : {})}
              onImportProvider={importProvider}
              onAddProvider={addProvider}
            />
          ))}
          {filtered.length === 0 && (
            <div className="rounded-xl border border-ink/10 p-6 text-center text-xs text-ink/40">
              {only ? `This build does not list a harness named “${only}”.` : `No harness matches “${query}”.`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
