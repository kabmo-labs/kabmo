/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The list for the chosen section.
 *
 * Three states that are NOT "empty", and each says its own thing:
 *
 * - **No workspace / no remote** is a refusal from the server, and the sentence
 *   names what to do (`git remote add origin …`);
 * - **A section with nothing in it** is a normal answer — a project with no
 *   releases has none — and must not read as a failure;
 * - **A truncated page** says so, because a silently short list reads as "this
 *   project has three issues", which is a wrong answer rather than a partial one.
 *
 * The notes the server returns (anonymous read, a section that failed) are shown
 * ABOVE the list rather than in a corner: a list that is missing because a token
 * is wrong looks exactly like a list that is genuinely empty.
 */

import type { ForgeItem, ForgeList, ForgeProvider, ForgeSection } from '../protocol';
import { Empty, Note } from '@kabmo-labs/kabmo-ui/components';

import { Glyph, ICON } from './Glyph';
import { ItemRow } from './Row';
import { sectionLabel } from './format';

interface ListProps {
  list: ForgeList | null;
  provider: ForgeProvider;
  section: ForgeSection;
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  onOpen: (item: ForgeItem) => void;
}

export function ItemList({ list, provider, section, selectedId, loading, error, onOpen }: ListProps) {
  if (error && !list) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Glyph path={ICON.forge} size={18} />
        <p className="max-w-sm text-[11px] leading-relaxed text-error">{error}</p>
      </div>
    );
  }

  if (!list) {
    return <Empty>{loading ? 'Reading from the host…' : 'No repository selected.'}</Empty>;
  }

  const data = list.sections[section];
  const name = sectionLabel(section, provider).toLowerCase();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {list.notes.length > 0 && (
        <div className="flex-shrink-0 border-b border-ink/10 px-2.5 py-1.5">
          {list.notes.map((note) => (
            <Note key={note}>{note}</Note>
          ))}
        </div>
      )}

      {data.failed ? (
        // The server already pushed the sentence into `notes` (shown above), so
        // this is the same fact in the place the list would have been: a failed
        // read is not an empty section, and only one of them is actionable.
        <Empty>{`The ${name} could not be read. See the note above.`}</Empty>
      ) : data.items.length === 0 ? (
        <Empty>{`No ${name} for this repository.`}</Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-overlay-container">
          {data.items.map((item) => (
            <ItemRow
              key={`${section}:${item.id}`}
              item={item}
              selected={item.id === selectedId}
              onOpen={() => onOpen(item)}
            />
          ))}
          {data.truncated && (
            <p className="px-2.5 py-2 text-[10px] text-ink/45">
              Showing the first {data.items.length} — the host returned a full page. Narrow the state filter to see
              fewer.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
