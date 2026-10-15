/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A git-installed plugin's freshness, and the one action that changes it.
 *
 * Its own component because the card is already the densest row in the pane and
 * this is a different KIND of fact from build state: the plugin's bundle is fine,
 * and what is stale is the commit it was cloned at. Four states, and each says
 * something different — never probed, up to date, behind, and the probe failed —
 * so collapsing them into a badge would make "unknown" read as "current".
 *
 * The commit SHAs are shortened to seven characters, which is what git itself
 * prints and enough to tell two commits apart by eye; the full value stays in the
 * `title` so a reader can copy it.
 */

import { ArrowDownToLine, Loader2 } from 'lucide-preact';
import type { PanelGitStatus } from '@/shared/types';

interface GitFreshnessProps {
  status: PanelGitStatus | undefined;
  /** The clone's origin, shown when there is nothing newer to report. */
  origin: string;
  busy: string | null;
  pluginId: string;
  onUpdate: (pluginId: string) => Promise<boolean>;
}

/** `a1b2c3d4e5` → `a1b2c3d`, the abbreviation git itself uses. */
function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : '?';
}

export function GitFreshness({ status, origin, busy, pluginId, onUpdate }: GitFreshnessProps) {
  const updating = busy === `update_git:${pluginId}`;

  if (!status) {
    return (
      <p className="text-[10px] text-ink/40 font-mono truncate" title={origin}>
        git · {origin} · not checked
      </p>
    );
  }

  if (status.error) {
    return (
      <p className="text-[10px] text-warning truncate" title={`${origin} — ${status.error}`}>
        git · could not reach {origin}
      </p>
    );
  }

  if (!status.updateAvailable) {
    return (
      <p className="text-[10px] text-ink/40 font-mono truncate" title={`${origin} @ ${status.current ?? '?'}`}>
        git · {shortSha(status.current)} · up to date
      </p>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-ink/50 font-mono truncate" title={`${origin}\n${status.current} → ${status.latest}`}>
        {shortSha(status.current)} → {shortSha(status.latest)}
      </span>
      <button
        type="button"
        onClick={() => void onUpdate(pluginId)}
        disabled={busy !== null}
        title={`Update from ${origin} — fetches the remote's commit and rebuilds the plugin`}
        className="ml-auto flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-ink/25 text-ink hover:bg-ink/5 disabled:opacity-40 flex-shrink-0"
      >
        {updating ? <Loader2 size={11} className="animate-spin" /> : <ArrowDownToLine size={11} />}
        Update
      </button>
    </div>
  );
}
