/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The list for the chosen section.
 *
 * Four states that are NOT "empty", and each says its own thing:
 *
 * - **No workspace / no remote** is a refusal from the server, and the sentence
 *   names what to do (`git remote add origin …`);
 * - **A section with nothing in it** is a normal answer — a project with no
 *   releases has none — and must not read as a failure;
 * - **A truncated page** says so, because a silently short list reads as "this
 *   project has three issues", which is a wrong answer rather than a partial one;
 * - **A read in flight** draws skeleton rows, so the list does not jump when the
 *   answer lands and the panel does not look frozen.
 *
 * The notes the server returns (anonymous read, a section that failed) are shown
 * ABOVE the list rather than in a corner: a list that is missing because a token
 * is wrong looks exactly like a list that is genuinely empty.
 *
 * **Arrow keys move between rows.** A forge list is a column of buttons, and a
 * reader who has opened one wants the next without reaching for the mouse. The
 * rows stay real buttons, so Enter and Space keep working natively.
 */

import type { ForgeItem, ForgeList, ForgeProvider, ForgeSection } from '../protocol';
import { Note } from '@kabmo-labs/kabmo-ui/components';

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
  onRetry: () => void;
}

/** The rows a keyboard reader can move between, in DOM order. */
function rowButtons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button[data-forge-row]')];
}

/** Move focus to the row `delta` away from the focused one, clamped. */
function moveFocus(container: HTMLElement, delta: number): void {
  const rows = rowButtons(container);
  if (rows.length === 0) return;
  const current = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next = current === -1 ? (delta > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, current + delta));
  rows[next]?.focus();
}

function onListKeyDown(event: KeyboardEvent): void {
  const container = event.currentTarget as HTMLElement;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveFocus(container, 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveFocus(container, -1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    rowButtons(container)[0]?.focus();
  } else if (event.key === 'End') {
    event.preventDefault();
    const rows = rowButtons(container);
    rows[rows.length - 1]?.focus();
  }
}

/** A loading list: the shape of a row, without the content. */
function SkeletonRows() {
  return (
    <div aria-hidden="true" className="flex flex-col">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex flex-col gap-1.5 border-b border-ink/8 px-2.5 py-2">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-10 flex-shrink-0 animate-pulse rounded bg-ink/10" />
            <span className="h-2.5 flex-1 animate-pulse rounded bg-ink/10" />
            <span className="h-2.5 w-6 flex-shrink-0 animate-pulse rounded bg-ink/10" />
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-8 animate-pulse rounded bg-ink/5" />
            <span className="h-2 w-16 animate-pulse rounded bg-ink/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A centred state: a mark, a sentence, and the one action that helps. */
function StateBlock({
  icon,
  title,
  hint,
  action,
}: {
  icon: string;
  title: string;
  hint?: string;
  action?: preact.ComponentChildren;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <span className="text-ink/40">
        <Glyph path={icon} size={20} />
      </span>
      <p className="text-[11px] leading-relaxed text-ink/70">{title}</p>
      {hint && <p className="max-w-xs text-[10px] leading-relaxed text-ink/55">{hint}</p>}
      {action}
    </div>
  );
}

export function ItemList({ list, provider, section, selectedId, loading, error, onOpen, onRetry }: ListProps) {
  if (error && !list) {
    return (
      <StateBlock
        icon={ICON.warning}
        title={error}
        action={
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 tap-target cursor-pointer rounded border border-ink/20 px-2.5 py-1 text-[10px] text-ink transition-colors hover:bg-ink/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            Try again
          </button>
        }
      />
    );
  }

  if (!list) {
    if (loading) {
      return (
        <div className="flex h-full min-h-0 flex-col" aria-busy="true" aria-label="Reading from the host">
          <SkeletonRows />
        </div>
      );
    }
    return <StateBlock icon={ICON.forge} title="No repository selected." hint="Pick a repository above to read its forge." />;
  }

  const data = list.sections[section];
  const name = sectionLabel(section, provider).toLowerCase();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error && (
        // A refresh that failed over a list that is still on screen is REPORTED
        // rather than silently left as the old rows: the reader would otherwise
        // be reading a snapshot of unknown age.
        <div className="flex flex-shrink-0 items-start gap-1.5 border-b border-ink/10 px-2.5 py-1.5" role="status">
          <span className="mt-0.5 flex-shrink-0 text-error-text">
            <Glyph path={ICON.warning} size={11} />
          </span>
          <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-error-text">{error}</p>
        </div>
      )}

      {list.notes.length > 0 && (
        <div className="flex flex-shrink-0 flex-col gap-0.5 border-b border-ink/10 px-2.5 py-1.5">
          {list.notes.map((note) => (
            <Note key={note}>{note}</Note>
          ))}
        </div>
      )}

      {data.failed ? (
        // The server already pushed the sentence into `notes` (shown above), so
        // this is the same fact in the place the list would have been: a failed
        // read is not an empty section, and only one of them is actionable.
        <StateBlock
          icon={ICON.warning}
          title={`The ${name} could not be read.`}
          hint="The note above names the reason."
          action={
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 tap-target cursor-pointer rounded border border-ink/20 px-2.5 py-1 text-[10px] text-ink transition-colors hover:bg-ink/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
            >
              Try again
            </button>
          }
        />
      ) : data.items.length === 0 ? (
        <StateBlock
          icon={ICON.inbox}
          title={`No ${name} for this repository.`}
          hint={list.filter.state === 'open' ? 'Try the Closed or All filter.' : undefined}
        />
      ) : (
        <div
          className="min-h-0 flex-1 overflow-y-auto scrollbar-overlay-container"
          onKeyDown={onListKeyDown}
          aria-busy={loading}
        >
          {data.items.map((item) => (
            <ItemRow key={`${section}:${item.id}`} item={item} selected={item.id === selectedId} onOpen={() => onOpen(item)} />
          ))}
          {data.truncated && (
            <p className="px-2.5 py-2 text-[10px] leading-relaxed text-ink/55">
              Showing the first {data.items.length}. The host returned a full page; raise "Items per section" in the
              plugin settings to read more.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
