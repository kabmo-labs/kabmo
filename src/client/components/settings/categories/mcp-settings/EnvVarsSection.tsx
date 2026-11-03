/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The environment variables an MCP server is launched with.
 *
 * Keys are shown as typed and never masked here: this is the file the user is
 * writing, and hiding a value in the form while showing it in `mcp.json` on the
 * next screen is the worse of the two. A blank key is kept (it is a half-typed
 * row, not a decision) and the server-side writer is what refuses an empty
 * name, so a save cannot invent an `""` variable.
 */

import { Plus, Trash2 } from 'lucide-preact';
import type { McpEnvVar } from '@/shared/types';

interface EnvVarsSectionProps {
  envVars: McpEnvVar[];
  onAdd: () => void;
  onUpdate: (id: string, key: string, value: string) => void;
  onRemove: (id: string) => void;
}

export function McpEnvVarsSection({ envVars, onAdd, onUpdate, onRemove }: EnvVarsSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Environment Variables</h3>
          <p className="text-[11px] text-ink/60 mt-0.5">Values the server needs, such as an API key.</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-ink/20 hover:border-ink/40 hover:bg-ink/5 text-ink transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add variable</span>
        </button>
      </div>

      {envVars.length === 0 ? (
        <div className="p-4 rounded-lg border border-dashed border-ink/20 text-center text-xs text-ink/50">
          No environment variables configured.
        </div>
      ) : (
        <div className="space-y-2">
          {envVars.map((env) => (
            <div key={env.id} className="flex items-center gap-2">
              <input
                type="text"
                value={env.key}
                onChange={(e) => onUpdate(env.id, e.currentTarget.value, env.value)}
                placeholder="KEY"
                aria-label="Variable name"
                className="w-1/3 text-xs font-mono px-3 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-ink transition-colors"
              />
              <input
                type="text"
                value={env.value}
                onChange={(e) => onUpdate(env.id, env.key, e.currentTarget.value)}
                placeholder="VALUE"
                aria-label={`Value for ${env.key || 'the variable'}`}
                className="flex-1 text-xs font-mono px-3 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-ink transition-colors"
              />
              <button
                type="button"
                onClick={() => onRemove(env.id)}
                aria-label={`Remove ${env.key || 'the variable'}`}
                title="Remove variable"
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
