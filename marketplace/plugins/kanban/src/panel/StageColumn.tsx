/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One stage column: its header, its count, and the drop target.
 *
 * A hidden stage that still holds cards KEEPS SHOWING — hiding is a way to quiet
 * a lane, not a way to lose a card. The panel decides that; this component just
 * renders what it is given, plus the "no cards" placeholder and the cap notice.
 */

import type { CardSummary, Stage } from '../protocol';
import { CardTile } from './CardTile';

/** A lane draws at most this many cards; the rest are summarised. */
export const MAX_VISIBLE_CARDS = 120;

export interface StageColumnProps {
  stage: Stage;
  cards: CardSummary[];
  showWorkspace: boolean;
  sessionStateOf: (card: CardSummary) => 'running' | 'needs-you' | 'idle' | 'none';
  draggingId: string | null;
  dropTarget: string | null;
  onOpenCard: (id: string) => void;
  onAddCard: (stageId: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDropOn: (stageId: string) => void;
  onDragOver: (stageId: string | null) => void;
}

/** One lane. */
export function StageColumn({
  stage,
  cards,
  showWorkspace,
  sessionStateOf,
  draggingId,
  dropTarget,
  onOpenCard,
  onAddCard,
  onDragStart,
  onDragEnd,
  onDropOn,
  onDragOver,
}: StageColumnProps) {
  const visible = cards.slice(0, MAX_VISIBLE_CARDS);
  const overflow = cards.length - visible.length;
  const active = dropTarget === stage.id;

  return (
    <section
      class={[
        'flex flex-col h-full min-h-0 rounded-xl border transition-colors',
        'w-[200px] flex-none bg-[var(--theme-canvas)]',
        active ? 'border-ink/40' : 'border-ink/10',
      ].join(' ')}
      aria-label={`${stage.label}, ${cards.length} card${cards.length === 1 ? '' : 's'}`}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver(stage.id);
      }}
      onDragLeave={() => onDragOver(null)}
      onDrop={(event) => {
        event.preventDefault();
        onDropOn(stage.id);
      }}
    >
      <header class="flex items-center gap-1.5 px-2.5 h-9 flex-none">
        <span class="text-xs font-medium text-ink truncate">{stage.label}</span>
        <span class="text-[11px] text-ink/45">{cards.length}</span>
        {stage.session ? (
          <span class="text-[9px] uppercase font-mono text-ink/35" title="Cards here run a chat session">
            session
          </span>
        ) : null}
        <button
          type="button"
          class="ml-auto text-ink/50 hover:text-ink px-1"
          title={`New card in ${stage.label}`}
          aria-label={`New card in ${stage.label}`}
          onClick={() => onAddCard(stage.id)}
        >
          +
        </button>
      </header>
      <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-2">
        {cards.length === 0 ? (
          <p class="text-[11px] text-ink/35 text-center py-6 border border-dashed border-ink/10 rounded-lg">
            No cards
          </p>
        ) : null}
        {visible.map((card) => (
          <CardTile
            key={card.id}
            card={card}
            showWorkspace={showWorkspace}
            sessionState={sessionStateOf(card)}
            onOpen={onOpenCard}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            dragging={draggingId === card.id}
          />
        ))}
        {overflow > 0 ? (
          <p class="text-[11px] text-ink/45 px-1">
            {overflow} more — narrow the filter
          </p>
        ) : null}
      </div>
    </section>
  );
}
