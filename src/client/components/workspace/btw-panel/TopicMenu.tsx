/**
 * BTW topic history dropdown — the ⌄ menu of the panel header.
 *
 * Pure presentation: it renders the topic list and reports dismissal; the open
 * state lives in `BtwHeader`.
 */

import { useEffect, useRef } from 'preact/hooks';
import { Trash2 } from 'lucide-preact';
import type { BtwTopic, BtwTurnStatus } from '@/shared/types/btw';

export interface BtwTopicMenuProps {
  topics: BtwTopic[];
  activeTopicId: string | null;
  onSelectTopic: (id: string) => void;
  /** Drop a topic and its transcript — a topic copies the parent session, so
   *  history nobody will reopen is real disk. */
  onDeleteTopic: (id: string) => void;
  /** Called after a selection and on outside click / Escape. */
  onCloseMenu: () => void;
}

const STATUS_LABEL: Record<BtwTurnStatus, string> = {
  running: 'thinking…',
  complete: 'complete',
  cancelled: 'cancelled',
  error: 'error',
  interrupted: 'interrupted',
};

/** `<turn count> · <status of the newest turn>` — the one-line topic summary. */
export function BtwTopicMenu({ topics, activeTopicId, onSelectTopic, onDeleteTopic, onCloseMenu }: BtwTopicMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Outside dismissal. Pointerdown (not click) so the menu is gone before the
  // underlying target reacts; the header toggle is exempt — it owns its own
  // open state and would otherwise re-open what this handler just closed.
  useEffect(() => {
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (menuRef.current?.contains(target)) return;
      if (target?.closest('[data-btw-menu-anchor]')) return;
      onCloseMenu();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onCloseMenu]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onCloseMenu();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCloseMenu]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Side question history"
      className="absolute left-0 top-full mt-1 z-50 bg-paper border border-ink/15 rounded-lg shadow-xl min-w-[280px] max-h-72 overflow-y-auto scrollbar-overlay-container p-1"
    >
      {topics.length === 0 && (
        <div className="px-2.5 py-2 text-[12px] text-ink/50">No side questions yet.</div>
      )}

      {topics.map((topic) => {
        const count = topic.turns.length;
        const newest = topic.turns[count - 1];

        return (
          <div
            key={topic.id}
            className={`group flex items-center rounded ${topic.id === activeTopicId ? 'bg-ink/5' : 'hover:bg-ink/5'}`}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onSelectTopic(topic.id);
                onCloseMenu();
              }}
              className="flex-1 min-w-0 text-left px-2.5 py-2 rounded cursor-pointer"
            >
              <div className="truncate text-[12px] text-ink">{topic.title}</div>
              <div className="text-[11px] text-ink/50">
                {count} turn{count === 1 ? '' : 's'}
                {newest ? ` · ${STATUS_LABEL[newest.status]}` : ''}
              </div>
            </button>
            <button
              type="button"
              onClick={() => onDeleteTopic(topic.id)}
              className="touch-visible p-1.5 mr-1 rounded text-ink/40 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-error hover:bg-error/10 transition-colors cursor-pointer"
              aria-label={`Delete side question: ${topic.title}`}
              title="Delete this side question"
            >
              <Trash2 size={12} strokeWidth={2} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
