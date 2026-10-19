/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A bundled plugin whose update a local edit stopped.
 *
 * A refusal, not a failure, and the wording has to carry that: Kabmo is
 * leaving the user's files alone, which is the outcome they want unless they were
 * editing by accident. The row therefore names WHICH files differ — without them
 * the user has to diff a directory against a version they cannot see — and offers
 * the one way past it, which replaces those files with the store's copy.
 *
 * The override is spelled as a consequence, not as a button label: "Sync anyway"
 * beside a file list reads as a harmless retry, while the action discards edits.
 */

import { AlertTriangle, Loader2, RotateCcw } from 'lucide-preact';
import type { PanelSyncBlocked } from '@/shared/types';

interface SyncBlockedNoticeProps {
  blocked: Record<string, PanelSyncBlocked>;
  busy: string | null;
  onForceSync: (pluginId: string) => Promise<boolean>;
}

/** The files listed before the rest are summarised. */
const VISIBLE_FILES = 5;

export function SyncBlockedNotice({ blocked, busy, onForceSync }: SyncBlockedNoticeProps) {
  const entries = Object.entries(blocked);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      {entries.map(([pluginId, record]) => {
        const shown = record.changed.slice(0, VISIBLE_FILES);
        const rest = record.changed.length - shown.length;
        return (
          <div key={pluginId} className="border border-warning/40 rounded p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-warning">
              <AlertTriangle size={14} className="flex-shrink-0" />
              <span className="text-xs">
                <span className="font-medium">{pluginId}</span> has local changes — its bundled update is paused
              </span>
            </div>
            <p className="text-[11px] text-ink/60">
              Kabmo installed this plugin, and {record.changed.length} of its files no longer match what it
              wrote. Your files are left as they are.
            </p>
            <ul className="text-[10px] font-mono text-ink/50 space-y-0.5">
              {shown.map((path) => (
                <li key={path} className="truncate" title={path}>
                  {path}
                </li>
              ))}
              {rest > 0 ? <li>… and {rest} more</li> : null}
            </ul>
            <div className="flex items-center gap-2 pt-0.5">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onForceSync(pluginId)}
                title={`Replace ${record.changed.length} changed file(s) with the copy Kabmo ships — your edits are lost`}
                className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded border border-warning/50 text-warning hover:bg-warning/10 disabled:opacity-50"
              >
                {busy === `force_sync:${pluginId}` ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RotateCcw size={12} />
                )}
                Replace my changes with the store's copy
              </button>
              <span className="text-[11px] text-ink/45">This discards the files listed above.</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
