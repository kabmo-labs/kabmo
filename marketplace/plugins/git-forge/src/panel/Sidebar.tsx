/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The section list — the panel's sidebar, drawn the way the wiki panel draws its
 * nav, with one difference forced by the subject: at a narrow container the
 * sections become a horizontal strip above the content instead of a column
 * beside it.
 *
 * The wiki can hide its nav behind a drill because a reader there goes nav →
 * page; a forge reader moves between sections constantly (a PR that closes an
 * issue is two sections apart), so the switch has to stay on screen at every
 * width. A strip costs one line and keeps the counts visible, where a drill
 * would bury the panel's primary axis one click deep.
 *
 * A count of zero is shown rather than hidden — "0 releases" is information, and
 * a missing row would make the reader wonder whether the section exists at all.
 * A `+` says the host returned a full page.
 *
 * There is no provider header here: the header's own badge already names the
 * host, and a second `GITHUB` label six lines below it was the panel saying the
 * same thing twice in a 40px column.
 *
 * The state filter (open / closed / all) is deliberately NOT here. It belongs to
 * the list it filters, so it sits in the header beside the refresh — a control
 * that changes the list must not look like a fourth section.
 */

import type { ForgeList, ForgeProvider, ForgeSection } from '../protocol';
import { Glyph, ICON } from './Glyph';
import { sectionLabel, sectionShort } from './format';

interface SidebarProps {
  sections: readonly ForgeSection[];
  active: ForgeSection;
  list: ForgeList | null;
  provider: ForgeProvider;
  onSelect: (section: ForgeSection) => void;
}

/** The mark a section's row carries, so the three are distinguishable at a glance. */
const SECTION_ICON: Record<ForgeSection, string> = {
  issues: ICON.issueOpen,
  pulls: ICON.pull,
  releases: ICON.release,
};

export function Sidebar({ sections, active, list, provider, onSelect }: SidebarProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-canvas/40">
      <div className="flex min-h-0 flex-1 flex-row overflow-x-auto scrollbar-overlay-container py-0.5 @[520px]:flex-col @[520px]:overflow-x-visible">
        {sections.map((section) => {
          const isActive = section === active;
          const data = list?.sections[section];
          const count = data ? data.items.length : null;
          const name = sectionLabel(section, provider);
          // The name is stated ONCE, explicitly. Both the long and the short
          // label are in the DOM (the breakpoint decides which is drawn), so
          // without this the accessible name concatenates them — measured as
          // `IssuesIssues2+`, which a screen reader reads as two words and a
          // count with no separation. The count is part of the name because it
          // is the reason the row exists.
          const accessibleName = count === null ? name : `${name} — ${count}${data?.truncated ? '+' : ''}`;
          return (
            <button
              key={section}
              type="button"
              onClick={() => onSelect(section)}
              title={name}
              aria-label={accessibleName}
              aria-current={isActive ? 'true' : undefined}
              className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-left text-xs transition-colors @[520px]:w-full @[520px]:whitespace-normal ${
                isActive ? 'bg-ink/8 font-medium text-ink' : 'text-ink/70 hover:bg-ink/5 hover:text-ink'
              }`}
            >
              <Glyph path={SECTION_ICON[section]} size={11} />
              <span aria-hidden="true" className="hidden truncate @[520px]:inline">
                {name}
              </span>
              <span aria-hidden="true" className="@[520px]:hidden">
                {sectionShort(section, provider)}
              </span>
              <span aria-hidden="true" className="ml-auto flex-shrink-0 pl-1 font-mono text-[10px] text-ink/40">
                {count === null ? '' : data?.truncated ? `${count}+` : count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
