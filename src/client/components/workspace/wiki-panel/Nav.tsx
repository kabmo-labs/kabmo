/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The wiki's navigation, rendered from its OWN `_Sidebar.md` when it has one.
 *
 * A sidebar is the author's navigation — its grouping, order and labels — so the
 * panel draws that rather than re-deriving a tree from the file layout. GitLab's
 * `### 📋 Changelogs` group and its `v1.6.0` labels are the author's; a list
 * built from folder names would show `CHANGE_LOGS` and `v1.6.0` in a different
 * order, and would lose the group entirely. A wiki without a sidebar (drawio's)
 * gets the folder-grouped fallback, so the panel never renders nothing.
 *
 * A link whose target is not in this wiki's tree is shown as inert text: it is
 * the author's dangling reference, and pretending it navigates would be worse
 * than showing it dimmed. An absolute one opens in the browser.
 */

import { useMemo, useState } from 'preact/hooks';
import { ExternalLink, Search } from 'lucide-preact';
import type { WikiNavSection } from '@/shared/types/wiki';

interface WikiNavProps {
  sections: readonly WikiNavSection[];
  selected: string | null;
  onSelect: (path: string) => void;
}

export function WikiNav({ sections, selected, onSelect }: WikiNavProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sections;
    return sections
      .map((section) => ({
        ...section,
        links: section.links.filter(
          (link) =>
            link.label.toLowerCase().includes(needle) || (link.path ?? link.target).toLowerCase().includes(needle),
        ),
      }))
      .filter((section) => section.links.length > 0);
  }, [sections, query]);

  const hasLinks = sections.some((section) => section.links.length > 0);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-canvas/40">
      <div className="flex items-center gap-1.5 border-b border-ink/10 px-2 py-1.5 flex-shrink-0">
        <Search size={11} className="flex-shrink-0 text-ink/40" />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Filter pages…"
          title="Filter wiki pages"
          className="w-full min-w-0 bg-transparent text-xs text-ink outline-none placeholder-ink/40"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} title="Clear filter" className="flex-shrink-0 text-ink/40 hover:text-ink">
            ×
          </button>
        )}
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto scrollbar-overlay-container"
      >
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-[11px] italic text-ink/40">
            {hasLinks ? 'No page matches the filter' : 'This wiki has no pages'}
          </p>
        ) : (
          filtered.map((section, index) => (
            <div key={`${section.title ?? 'links'}-${index}`} className="py-0.5">
              {section.title && (
                <div className="px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-wider text-ink/40">
                  {section.title}
                </div>
              )}
              {section.links.map((link, linkIndex) => {
                const isSelected = link.path !== null && link.path === selected;
                const key = `${link.path ?? link.target}-${linkIndex}`;
                if (link.path) {
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onSelect(link.path as string)}
                      title={link.path}
                      aria-current={isSelected ? 'page' : undefined}
                      className={`flex w-full items-center gap-1 px-2.5 py-1 text-left text-xs transition-colors ${
                        isSelected ? 'bg-ink/8 font-medium text-ink' : 'text-ink/70 hover:bg-ink/5 hover:text-ink'
                      }`}
                    >
                      <span className="truncate">{link.label}</span>
                    </button>
                  );
                }
                if (link.url) {
                  return (
                    <a
                      key={key}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={link.url}
                      className="flex w-full items-center gap-1 px-2.5 py-1 text-left text-xs text-ink/70 hover:bg-ink/5 hover:text-ink"
                    >
                      <span className="truncate">{link.label}</span>
                      <ExternalLink size={10} className="flex-shrink-0 text-ink/30" />
                    </a>
                  );
                }
                // A target that is not in this wiki: shown, dimmed, inert.
                return (
                  <div
                    key={key}
                    title={`Not in this wiki: ${link.target}`}
                    className="flex w-full items-center px-2.5 py-1 text-left text-xs text-ink/35 line-through decoration-ink/20"
                  >
                    <span className="truncate">{link.label}</span>
                  </div>
                );
              })}
              {section.notes.map((note, noteIndex) => (
                <p key={`note-${noteIndex}`} className="px-2.5 py-0.5 text-[10px] leading-snug text-ink/50">
                  {note}
                </p>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
