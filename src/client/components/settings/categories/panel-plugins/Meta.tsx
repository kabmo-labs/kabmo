/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The small pieces every panel-plugin card is built from.
 *
 * One module rather than markup repeated in the installed card and the store
 * card: both describe the same plugin in the same vocabulary, and the version
 * line, the author line and the slot badges were exactly the three places they
 * drifted apart — a store card saying `v0.2.0` while the installed card said
 * `0.2.0`, a contribution chip reading `rightPanel` on one and `Panel view` on
 * the other.
 *
 * The palette is the app's: ink at varying opacity, `text-warning` for a
 * pending update, `text-error` for a refusal. Nothing here introduces a colour.
 */

import { ExternalLink, FolderInput, GitBranch, Package, Store } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import type { PanelPluginAuthor, PanelPluginOrigin } from '@/shared/types';
import { isNewer } from '@/shared/lib/updates/semver';
import type { PluginContribution } from '@/client/hooks/workspace/plugin-contributions';

/**
 * The installed version, and the newer one when there is one.
 *
 * Both numbers are shown together because either alone is a half answer: the
 * installed version says what is running, the newer one says what updating would
 * give. The arrow only appears when the source's version is strictly NEWER —
 * an equal version renders as one number, or every up-to-date plugin would carry
 * a pointless pair.
 */
export function VersionLine({ version, latest }: { version: string; latest?: string | undefined }) {
  const newer = Boolean(latest && version && isNewer(latest, version));
  if (!version) {
    return <span className="text-[10px] font-mono text-ink/40">unversioned</span>;
  }
  if (!newer) {
    return (
      <span className="text-[10px] font-mono text-ink/50" title={`Installed version ${version}`}>
        v{version}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] font-mono" title={`Installed ${version}, available ${latest}`}>
      <span className="text-ink/45">v{version}</span>
      <span className="text-ink/30">→</span>
      <span className="px-1 rounded bg-warning/15 text-warning border border-warning/25">v{latest}</span>
    </span>
  );
}

/** Who wrote the plugin. Absent when the manifest names nobody. */
export function AuthorLine({ author }: { author: PanelPluginAuthor | undefined }) {
  if (!author) return <span className="text-[10px] text-ink/40">author unknown</span>;
  const label = `by ${author.name}`;
  if (!author.url) {
    return (
      <span className="text-[10px] text-ink/50 truncate" title={author.email ? `${author.name} <${author.email}>` : label}>
        {label}
      </span>
    );
  }
  return (
    <a
      href={author.url}
      target="_blank"
      rel="noreferrer noopener"
      className="flex items-center gap-0.5 text-[10px] text-ink/50 hover:text-ink truncate"
      title={author.url}
    >
      {label}
      <ExternalLink size={9} className="flex-shrink-0" />
    </a>
  );
}

const ORIGIN_FACTS: Record<PanelPluginOrigin, { label: string; detail: string; Icon: typeof Package }> = {
  bundled: {
    label: 'Bundled',
    detail: 'Installed from Kabmo’s own store, and kept current by Kabmo’s update.',
    Icon: Store,
  },
  git: {
    label: 'Git',
    detail: 'A git clone you own. Update it from its remote, or turn on automatic updates above.',
    Icon: GitBranch,
  },
  local: {
    label: 'Local',
    detail: 'A directory in the marketplace. Nothing updates it — edit the files and rebuild.',
    Icon: FolderInput,
  },
};

/** Where this install came from, which is also what keeps it current. */
export function OriginBadge({ origin }: { origin: PanelPluginOrigin }) {
  const fact = ORIGIN_FACTS[origin];
  return (
    <span
      className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-ink/5 border border-ink/10 text-[10px] text-ink/55"
      title={fact.detail}
    >
      <fact.Icon size={10} className="flex-shrink-0" />
      {fact.label}
    </span>
  );
}

/** One contributed slot, named in words with its count. */
export function SlotBadge({ item, declared }: { item: PluginContribution; declared: boolean }) {
  return (
    <span
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${
        declared
          ? 'border border-dashed border-ink/25 text-ink/45'
          : 'bg-ink/10 text-ink/65'
      }`}
      title={declared ? `${item.detail} (declared by the manifest — its bundle has not registered it)` : item.detail}
    >
      {item.label}
      {item.count > 1 ? <span className="font-mono text-ink/50">×{item.count}</span> : null}
      {item.title ? <span className="text-ink/40 truncate max-w-[9rem]">· {item.title}</span> : null}
    </span>
  );
}

/**
 * The slots a plugin contributes, wrapped so a narrow card still reads.
 *
 * `declared` is the whole point of the dashed variant: a manifest's claim is not
 * the same fact as a live registration, and a reader who is deciding whether to
 * switch a plugin on needs to know which one they are looking at.
 */
export function SlotBadges({ items, declared }: { items: PluginContribution[]; declared: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map((item) => (
        <SlotBadge key={item.key} item={item} declared={declared} />
      ))}
    </div>
  );
}

/** A label/value pair for the facts strip. `value` may be a node. */
export function Fact({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <span className="flex items-baseline gap-1 min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-ink/35 flex-shrink-0">{label}</span>
      <span className="text-[10px] text-ink/60 truncate min-w-0">{children}</span>
    </span>
  );
}
