/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Harnesses: the roster, and one page per agent in it.
 *
 * Two shapes, and they answer two different questions:
 *
 *  - **the overview** (`only` absent) is a LIST with a switch per row. The
 *    roster question is "which agents do I run here?", and twelve full cards —
 *    capabilities, config form, provider panel each — turned it into a page you
 *    scroll. Switching one ON probes it once (server-side, in the same request)
 *    so its models are ready; switching one OFF removes its settings page and
 *    its tab in the composer's model picker.
 *  - **one harness** (`only` set) is that agent's CARD: live status, what it
 *    advertised, its launch command and providers. The card is the same component
 *    the drawer's per-agent pages draw, so a single view cannot disagree with the
 *    overview about what an agent can do.
 *
 * What this page deliberately does NOT own: omp's own settings. Those live under
 * OMP Engine and Providers and are omp-specific; duplicating them here would be
 * two write paths for one config file.
 */

import { useMemo, useState } from 'preact/hooks';
import { RefreshCw } from 'lucide-preact';
import { useHarnesses } from '@/client/hooks/models/use-harnesses';
import { HarnessCard } from '@/client/components/settings/categories/harness-settings/HarnessCard';
import { HarnessToggleList } from '@/client/components/settings/categories/harness-settings/ToggleList';
import { CustomHarnessForm } from '@/client/components/settings/categories/harness-settings/CustomHarnessForm';
import { SettingsNotice, SettingsSearchField } from '@/client/components/settings/categories/harness-settings/parts';
import { harnessCategoryId } from '@/shared/lib/harness/menu';

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
    setEnabled,
  } = useHarnesses();
  const [query, setQuery] = useState('');
  // Which switch, or which Check, is in flight. ONE field for both because both
  // are the same row's busy state and the row draws one spinner.
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The catalog error the user closed, by its TEXT rather than a boolean: a
  // dismissal must not also swallow the NEXT, different failure — which a
  // boolean would, leaving a broken catalog silent forever.
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  // The built-in transport is NOT listed: `omp` over RPC is the default every
  // discovered session already runs on, with nothing to install, probe or
  // configure — its card could only say "no launch command is configured" beside
  // a Check status button that could never succeed. It stays in the catalog
  // because a session row still names the transport that ran it.
  const installable = useMemo(() => harnesses.filter((entry) => !entry.builtIn), [harnesses]);

  const filtered = useMemo(() => {
    // A single-harness page is not a search surface: it shows the one agent the
    // menu names, and nothing else can match. It also shows a SWITCHED-OFF agent
    // if the user gets here from a stale link, with the switch right there.
    if (only) return installable.filter((entry) => entry.id === only);
    const needle = query.trim().toLowerCase();
    if (!needle) return installable;
    return installable.filter((entry) =>
      entry.label.toLowerCase().includes(needle)
      || entry.id.includes(needle)
      || (entry.note ?? '').toLowerCase().includes(needle),
    );
  }, [installable, query, only]);

  const enabledCount = installable.filter((entry) => entry.enabled).length;
  const ready = installable.filter(
    (entry) => entry.enabled && entry.probe && !entry.probe.capabilities.blocked,
  ).length;

  /** Switch a row and keep its busy state and refusal in one place. */
  const toggle = async (id: string, enabled: boolean) => {
    setBusy(id);
    setProblem(null);
    try {
      setProblem(await setEnabled(id, enabled));
    } finally {
      setBusy(null);
    }
  };

  const check = async (id: string) => {
    setBusy(id);
    setProblem(null);
    try {
      setProblem(await probe(id));
    } finally {
      setBusy(null);
    }
  };

  /** Open that agent's settings page. A full navigation would lose the modal, so
   *  it is the same event the rest of the app uses to ask for a category. */
  const openHarness = (id: string) => {
    window.dispatchEvent(
      new CustomEvent('omp:open-settings', { detail: { category: harnessCategoryId(id) } }),
    );
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">
            {only ? (harnesses.find((entry) => entry.id === only)?.label ?? only) : 'All Harnesses'}
          </h2>
          <p className="mt-0.5 text-xs text-ink/50">
            {only
              ? 'Providers, launch command, and the defaults a new chat on this agent starts on.'
              : 'Switch on the agents you run. An agent that is off keeps no settings page and no tab in the model picker; switching one on probes it once.'}
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={isLoading}
          aria-busy={isLoading}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-ink/20 px-2.5 py-1.5 text-[11px] text-ink/70 transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-50"
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : undefined} /> Reload catalog
        </button>
      </header>

      {/* The overview counts and searches; a single-harness page has one card and
          needs neither. */}
      {!only && (
        <div className="flex flex-wrap items-center gap-3">
          <SettingsSearchField value={query} onChange={setQuery} placeholder="Search harnesses" />
          <span className="text-[11px] text-ink/45">
            {enabledCount}/{installable.length} on · {ready} probed ready
          </span>
        </div>
      )}

      {error && error !== dismissedError && (
        <SettingsNotice
          message={error}
          onDismiss={() => setDismissedError(error)}
          dismissLabel="Dismiss the catalog error"
        />
      )}

      {/* A refused switch or a refused probe is the agent's own words, shown
          above the list rather than in a toast that would close with them. */}
      {problem && (
        <SettingsNotice
          message={problem}
          onDismiss={() => setProblem(null)}
          dismissLabel="Dismiss this message"
        />
      )}

      {isLoading && harnesses.length === 0 ? (
        <div className="rounded-xl border border-ink/10 p-6 text-center text-xs text-ink/40">Reading the harness catalog…</div>
      ) : only ? (
        <div className="space-y-3">
          {filtered.map((summary) => (
            <HarnessCard
              key={summary.id}
              summary={summary}
              onProbe={probe}
              install={summary.install}
              config={configs[summary.id]}
              onSaveConfig={saveConfig}
              onSetEnabled={(enabled) => void toggle(summary.id, enabled)}
              busy={busy === summary.id}
              {...(providerSupport[summary.id] ? { providerSupport: providerSupport[summary.id] } : {})}
              onImportProvider={importProvider}
              onAddProvider={addProvider}
            />
          ))}
          {filtered.length === 0 && (
            <div className="rounded-xl border border-ink/10 p-6 text-center text-xs text-ink/40">
              This build does not list a harness named “{only}”.
            </div>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-ink/10 p-6 text-center text-xs text-ink/40">
          No harness matches “{query}”.
        </div>
      ) : (
        <>
          <HarnessToggleList
            harnesses={filtered}
            busy={busy}
            onSetEnabled={(id, enabled) => void toggle(id, enabled)}
            onOpen={openHarness}
            onProbe={(id) => void check(id)}
          />
          <CustomHarnessForm harnesses={harnesses} onChanged={reload} />
        </>
      )}
    </div>
  );
}
