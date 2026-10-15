import { useEffect, useRef } from 'preact/hooks';
import type { ReactElement } from 'preact/compat';
import type { ComposerMatchItem, ComposerPickItem, ComposerPickKind, ComposerTriggerPhase } from '@/shared/types';

export interface ComposerPickerProps {
  open: boolean;
  kind: ComposerPickKind;
  /**
   * Which way the popup opens. `up` (the default) is the docked composer's
   * placement: the chat is above it, so the list grows into that space. `over`
   * draws it INSIDE the textarea's own box, which is what a composer filling
   * the viewport needs — its top edge is the screen's, so an upward list would
   * be drawn off the viewport with nothing to scroll back to.
   */
  placement?: ComposerPickerPlacement;
  /** `args` swaps the header for the subcommand hint of the typed command. */
  phase?: ComposerTriggerPhase;
  items: ComposerMatchItem[];
  activeIndex: number;
  loading: boolean;
  error: string | null;
  listboxId: string;
  optionId: (index: number) => string;
  onSelect: (item: ComposerPickItem) => void;
  onHover: (index: number) => void;
}

export type ComposerPickerPlacement = 'up' | 'over';

/** Hard cap on rendered rows so a huge catalog cannot blow up the DOM. */
const MAX_OPTIONS = 100;

function OptionName({ item }: { item: ComposerMatchItem }) {
  const match = item.match;
  if (!match || match.start < 0 || match.start >= match.end || match.end > item.name.length) {
    return <>{item.name}</>;
  }
  return (
    <>
      {item.name.slice(0, match.start)}
      <mark className="bg-transparent font-semibold text-ink">
        {item.name.slice(match.start, match.end)}
      </mark>
      {item.name.slice(match.end)}
    </>
  );
}

export function ComposerPicker({
  open,
  kind,
  placement = 'up',
  phase = 'name',
  items,
  activeIndex,
  loading,
  error,
  listboxId,
  optionId,
  onSelect,
  onHover,
}: ComposerPickerProps): ReactElement | null {
  const activeOptionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    activeOptionRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, items.length]);

  if (!open) return null;

  const isMention = kind === 'mention';
  const isArgs = !isMention && phase === 'args';
  const headerText = isMention
    ? 'Type to search files and agents'
    : isArgs
      ? 'Pick a subcommand'
      : 'Type to search commands and skills';
  const ariaLabel = isMention ? 'Files and agents' : isArgs ? 'Subcommands' : 'Commands and skills';
  const emptyText = isMention
    ? 'No matching files or agents'
    : isArgs
      ? 'No matching subcommands'
      : 'No matching commands or skills';

  return (
    <div
      role="listbox"
      id={listboxId}
      aria-label={ariaLabel}
      className={`absolute left-0 right-0 z-50 min-w-[260px] flex max-h-60 flex-col rounded-md border border-ink/20 bg-paper shadow-lg text-sm ${
        placement === 'over' ? 'top-2' : 'bottom-full mb-1'
      }`}
    >
      <div className="shrink-0 text-[10px] uppercase tracking-wider text-ink/40 px-3 py-1.5 border-b border-ink/10">
        {headerText}
      </div>

      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="px-3 py-2 text-error">{error}</div>
        ) : loading && items.length === 0 ? (
          <div className="px-3 py-2 text-ink/50">Loading…</div>
        ) : items.length === 0 ? (
          <div className="px-3 py-2 text-ink/50">{emptyText}</div>
        ) : (
          items.slice(0, MAX_OPTIONS).map((item, index) => (
            <div
              key={item.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              ref={index === activeIndex ? activeOptionRef : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => onHover(index)}
              onClick={() => onSelect(item)}
              className={`px-3 py-2 cursor-pointer ${index === activeIndex ? 'bg-ink/10' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">
                  <OptionName item={item} />
                </span>
                {item.source === 'file' && (
                  <span className="text-ink/40 text-[10px] uppercase shrink-0">file</span>
                )}
                {item.source === 'skill' && (
                  <span className="text-ink/40 text-[10px] uppercase shrink-0">skill</span>
                )}
              </div>
              <div className="truncate text-ink/50 text-xs">{item.description}</div>
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 px-3 py-1.5 border-t border-ink/10 text-[10px] text-ink/40">
        ↑↓ navigate · Enter select · Esc close
      </div>
    </div>
  );
}
