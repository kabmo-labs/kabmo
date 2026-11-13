/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One editable key/value list — environment variables for a stdio server,
 * request headers for an HTTP/SSE one.
 *
 * Keys are shown as typed and never masked here: this is the file the user is
 * writing, and hiding a value in the form while showing it in `mcp.json` on the
 * next screen is the worse of the two. A blank key is kept (it is a half-typed
 * row, not a decision) and the server-side writer is what refuses an empty
 * name, so a save cannot invent an `""` entry.
 */

import { Plus, Trash2 } from 'lucide-preact';
import type { McpKeyValue } from '@/shared/types';

interface McpKeyValueSectionProps {
  title: string;
  description: string;
  addLabel: string;
  emptyLabel: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  rows: McpKeyValue[];
  onAdd: () => void;
  onUpdate: (id: string, key: string, value: string) => void;
  onRemove: (id: string) => void;
}

export function McpKeyValueSection({
  title,
  description,
  addLabel,
  emptyLabel,
  keyPlaceholder,
  valuePlaceholder,
  rows,
  onAdd,
  onUpdate,
  onRemove,
}: McpKeyValueSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink">{title}</h3>
          <p className="text-[11px] text-ink/60 mt-0.5">{description}</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-ink/20 hover:border-ink/40 hover:bg-ink/5 text-ink transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{addLabel}</span>
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="p-4 rounded-lg border border-dashed border-ink/20 text-center text-xs text-ink/50">
          {emptyLabel}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              <input
                type="text"
                value={row.key}
                onChange={(e) => onUpdate(row.id, e.currentTarget.value, row.value)}
                placeholder={keyPlaceholder}
                aria-label={`${title} name`}
                className="w-1/3 text-xs font-mono px-3 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-ink transition-colors"
              />
              <input
                type="text"
                value={row.value}
                onChange={(e) => onUpdate(row.id, row.key, e.currentTarget.value)}
                placeholder={valuePlaceholder}
                aria-label={`Value for ${row.key || 'the entry'}`}
                className="flex-1 text-xs font-mono px-3 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-ink transition-colors"
              />
              <button
                type="button"
                onClick={() => onRemove(row.id)}
                aria-label={`Remove ${row.key || 'the entry'}`}
                title="Remove"
                className="p-1.5 text-ink/40 hover:text-error transition-colors rounded-md cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
