/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Extension list — TS/JS modules loaded from .omp/extensions. Toggling
 * disabled writes to config.yml through /api/omp/extensions.
 *
 * The control is a SWITCH, not a `<select>`: the row's value is a boolean, and
 * a select that reports "enabled"/"disabled" while its `onChange` ignores the
 * chosen value reads as a two-state control that cannot be trusted. The switch
 * disables only its own row while the write is in flight, so one slow toggle
 * does not freeze the list, and the empty case is stated rather than returning
 * `null` (a panel that vanishes is indistinguishable from a broken one).
 */

import { Check, Loader2, Puzzle } from 'lucide-preact';
import type { ExtensionItem } from '@/client/components/settings/categories/omp-settings/types';

interface ExtensionsPanelProps {
  extensions: ExtensionItem[];
  savedExtension: string | null;
  /** Ids whose toggle is in flight. */
  pendingIds: Set<string>;
  onToggle: (extension: ExtensionItem) => void;
}

export function ExtensionsPanel({ extensions, savedExtension, pendingIds, onToggle }: ExtensionsPanelProps) {
  return (
    <div className="pt-2">
      <div className="flex items-center justify-between pb-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">Extensions</h3>
          <p className="text-ink/50 mt-0.5">
            TS/JS modules loaded from <span className="font-mono">.omp/extensions</span>. Disabling one writes to
            config.yml and applies to the next session.
          </p>
        </div>
        {savedExtension && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-ink/60">
            <Check size={11} /> saved
          </span>
        )}
      </div>
      {extensions.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-ink/15 px-3 py-3 text-[11px] text-ink/50">
          <Puzzle size={13} className="text-ink/35" />
          <span>
            No extension modules found. Add a <span className="font-mono">.ts</span> or{' '}
            <span className="font-mono">.js</span> file under{' '}
            <span className="font-mono">~/.omp/extensions</span> (or a workspace’s{' '}
            <span className="font-mono">.omp/extensions</span>) and refresh.
          </span>
        </div>
      ) : (
        <div className="rounded-lg border border-ink/10 divide-y divide-ink/5">
          {extensions.map((extension) => {
            const enabled = !extension.disabled;
            const pending = pendingIds.has(extension.id);
            return (
              <div key={extension.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="font-medium text-ink">{extension.name}</div>
                  <div className="text-[10px] text-ink/40 truncate font-mono" title={`${extension.sourceRoot}/${extension.filePath}`}>
                    {extension.sourceRoot} · {extension.filePath}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[10px] text-ink/40">{pending ? 'saving…' : enabled ? 'enabled' : 'disabled'}</span>
                  {pending && <Loader2 size={11} className="animate-spin text-ink/40" />}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`${extension.name} enabled`}
                    disabled={pending}
                    onClick={() => onToggle(extension)}
                    className={`relative h-5 w-9 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-progress ${
                      enabled ? 'bg-ink' : 'bg-ink/15'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-paper shadow-sm transition-all ${
                        enabled ? 'left-[18px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
