/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Extension list — TS/JS modules loaded from .omp/extensions. Toggling
 * disabled writes to config.yml through /api/omp/extensions.
 */

import { Check } from 'lucide-preact';

interface ExtensionItem {
  id: string;
  name: string;
  sourceRoot: string;
  filePath: string;
  disabled: boolean;
}

interface ExtensionsPanelProps {
  extensions: ExtensionItem[];
  savedExtension: string | null;
  onToggle: (extension: ExtensionItem) => void;
}

export function ExtensionsPanel({ extensions, savedExtension, onToggle }: ExtensionsPanelProps) {
  if (extensions.length === 0) return null;
  return (
    <div className="pt-2">
      <div className="flex items-center justify-between pb-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">Extensions</h3>
          <p className="text-ink/50 mt-0.5">TS/JS modules loaded from .omp/extensions. Disable writes to config.yml.</p>
        </div>
        {savedExtension && (
          <span className="inline-flex items-center gap-1 text-[10px] text-ink/60"><Check size={11} /> saved</span>
        )}
      </div>
      <div className="rounded-lg border border-ink/10 divide-y divide-ink/5">
        {extensions.map((extension) => (
          <div key={extension.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <div className="font-medium text-ink">{extension.name}</div>
              <div className="text-[10px] text-ink/40 truncate font-mono">{extension.sourceRoot} · {extension.filePath}</div>
            </div>
            <select
              aria-label={`${extension.name} enabled`}
              value={extension.disabled ? 'false' : 'true'}
              onChange={() => onToggle(extension)}
              className="bg-paper border border-ink/15 rounded-md px-2 py-1 text-ink"
            >
              <option value="true">enabled</option>
              <option value="false">disabled</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
