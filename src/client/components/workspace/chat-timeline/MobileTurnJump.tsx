import { useState } from 'preact/hooks';
import { ListOrdered } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import { formatMessageStamp } from '@kabmo-labs/kabmo-format/time';
import type { UserTurnRef } from '@/shared/types';

interface MobileTurnJumpProps {
  /** Every user turn of the session, oldest first — the same list the desktop
   *  rail is drawn from, so a turn outside the mounted window still pages
   *  history in when it is picked. */
  turns: UserTurnRef[];
  /** A jump is paging history to reach the clicked turn. */
  jumping: boolean;
  onJumpTurn: (turn: UserTurnRef) => void;
}

/**
 * Touch counterpart of the desktop jump rail. The rail is one 1px line per
 * user turn with a hover tooltip — a pointer target a finger cannot aim at,
 * and a preview a phone cannot hover — so it is dropped on mobile rather than
 * shrunk. This keeps the same turns and the same jump behind a tap-sized
 * control: a button at the timeline's top-right that opens the turn list.
 *
 * It floats over the messages rather than occupying a band above them: a
 * reserved 36px strip would cost a phone that much of the reading area for a
 * control used occasionally, and the top-right corner is the one a message
 * row reaches last as content scrolls.
 *
 * The list runs NEWEST FIRST. On a phone the reason to open it is almost
 * always to return to something recent, and oldest-first would open on the
 * first turn of the conversation with the target a long scroll away. The
 * ordinal still counts from the conversation's own first turn, so the numbers
 * match the rail's `#N of total`.
 */
export function MobileTurnJump({ turns, jumping, onJumpTurn }: MobileTurnJumpProps) {
  const [open, setOpen] = useState(false);
  if (turns.length === 0) return null;

  const rows = turns.map((turn, idx) => ({ turn, idx })).reverse();

  const handlePick = (turn: UserTurnRef) => {
    setOpen(false);
    onJumpTurn(turn);
  };

  return (
    <>
      <div className="absolute top-3 right-3 z-20">
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={jumping}
          aria-label={`Jump to your message (${turns.length} turns)`}
          aria-busy={jumping}
          title="Jump to your message"
          className={`flex items-center justify-center w-9 h-9 rounded-full border border-ink/20 bg-paper text-ink/60 shadow-sm transition-all ${jumping ? 'animate-pulse' : 'hover:text-ink hover:bg-ink/5'}`}
        >
          <ListOrdered size={16} />
        </button>
      </div>

      {open && (
        <Modal
          onClose={() => setOpen(false)}
          maxWidthClass="max-w-sm"
          header={
            <div className="flex items-center gap-2 min-w-0">
              <ListOrdered size={15} className="flex-shrink-0 text-ink/50" />
              <span className="text-sm font-medium">Jump to your message</span>
              <span className="font-mono text-[11px] text-ink/40">{turns.length}</span>
            </div>
          }
        >
          <div className="py-1">
            {rows.map(({ turn, idx }) => {
              const stamp = formatMessageStamp(turn);
              return (
                <button
                  key={`mobile-jump-${turn.id}`}
                  type="button"
                  onClick={() => handlePick(turn)}
                  aria-label={`Jump to your message #${idx + 1} of ${turns.length}`}
                  className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ink/5 active:bg-ink/10"
                >
                  <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-ink/5 font-mono text-[10px] text-ink/50">
                    {idx + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block text-xs leading-relaxed break-words text-ink">
                      {turn.preview.trim() || '(no text)'}
                    </span>
                    {stamp && (
                      <span className="mt-0.5 block font-mono text-[10px] text-ink/40">{stamp}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </Modal>
      )}
    </>
  );
}
