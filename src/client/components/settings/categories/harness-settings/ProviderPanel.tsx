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
 *    importable from elsewhere (`omp models.yml`, another agent's registry) and
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
 * Imports are CUSTOM providers only. A registry ships its own providers, and one
 * of those copied across writes an override of the TARGET's vendor entry instead
 * of adding a gateway — the server filters and refuses them, and the rows here
 * say so rather than hiding the fact. Each row also names the protocol it speaks
 * and whether THIS harness can take it, so a refusal is visible before a click.
 *
 * The import rows carry no credentials. Picking one and confirming is what reads
 * the key, from the source file, in the request that writes the target.
 */

import type { HarnessImportOutcome, HarnessProviderSupport } from '@/shared/types/harness';
import { PROTOCOL_LABELS } from '@/shared/lib/harness/dialects';
import { EnvProviderForm } from '@/client/components/settings/categories/harness-settings/EnvProviderForm';
import {
  ConfiguredList, ImportSection, ReadOnlyRows,
} from '@/client/components/settings/categories/harness-settings/ImportSection';
import {
  AddProviderForm, type AddProviderInput,
} from '@/client/components/settings/categories/harness-settings/AddProviderForm';

type ImportRow = HarnessProviderSupport['importable'][number];

interface ProviderPanelProps {
  support: HarnessProviderSupport;
  /** Save env-style providers into this harness's config. */
  onSaveEnv?: (env: string) => Promise<string | null>;
  /** Copy one provider out of a source registry into this harness.
   *
   *  The whole ROW travels, not just its id: the writer needs the endpoint, the
   *  protocol and the model list, and re-reading them server-side would be a
   *  second lookup of something the list already answered. The credential is
   *  still not in the row — the server reads that from the source file. */
  onImport?: (sourceId: string, entry: ImportRow) => Promise<HarnessImportOutcome>;
  /** Type one in: the endpoint and key a user already has. The route probes the
   *  host and picks a protocol, so this is the typed twin of `onImport`. */
  onAddProvider?: (input: AddProviderInput) => Promise<HarnessImportOutcome>;
}

export function HarnessProviderPanel({ support, onSaveEnv, onImport, onAddProvider }: ProviderPanelProps) {
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
        {onAddProvider && <AddProviderForm support={support} onAdd={onAddProvider} />}
        {onImport && <ImportSection support={support} onImport={onImport} />}
      </div>
    );
  }

  // `full`: a real registry, with imports from the sources this harness allows.
  return <FullProviderPanel support={support} onImport={onImport} onAddProvider={onAddProvider} />;
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
  support, onImport, onAddProvider,
}: {
  support: HarnessProviderSupport;
  onImport?: (sourceId: string, entry: ImportRow) => Promise<HarnessImportOutcome>;
  onAddProvider?: (input: AddProviderInput) => Promise<HarnessImportOutcome>;
}) {
  return (
    <div className="mt-3 space-y-2 border-t border-ink/10 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/45">Providers</span>
        <span className="font-mono text-[10px] text-ink/40" title={support.file || undefined}>
          {support.fileLabel}{support.pointer ? ` · ${support.pointer}` : ''}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-ink/55">{support.summary}</p>
      <div className="flex flex-wrap gap-1">
        {support.protocols.map((protocol) => (
          <span
            key={protocol}
            className="rounded border border-ink/15 px-1.5 py-0.5 font-mono text-[9px] text-ink/50"
          >
            {PROTOCOL_LABELS[protocol]}
          </span>
        ))}
      </div>

      {support.configured.length > 0 && <ConfiguredList support={support} />}
      {onAddProvider && <AddProviderForm support={support} onAdd={onAddProvider} />}

      {support.importable.length === 0 ? (
        <p className="text-[10px] text-ink/40">
          Nothing to import yet — the other agents' registries hold no provider you registered yourself.
        </p>
      ) : (
        // The rows are still SHOWN when this build has no writer: they are what
        // the sources hold, and hiding them made a working reader look like an
        // empty registry. The action is what is missing, so the button is
        // disabled and the sentence below says why.
        <div>
          {onImport ? (
            <ImportSection support={support} onImport={onImport} />
          ) : (
            <ReadOnlyRows support={support} />
          )}
        </div>
      )}
    </div>
  );
}
