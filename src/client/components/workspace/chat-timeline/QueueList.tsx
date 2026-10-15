import { useRef } from 'preact/hooks';
import { GripVertical, Pencil, Send, X } from 'lucide-preact';
import type { QueuedMessage } from '@/shared/types';

export type { QueuedMessage };

interface QueueListProps {
  queue: QueuedMessage[];
  /** Reorder handler (drag-and-drop): receives the new id order. */
  onReorder?: (orderedIds: string[]) => void;
  /** Remove one row by id. */
  onRemove?: (id: string) => void;
  onEdit?: (item: QueuedMessage) => void;
  /** Deliver the item now (Send Now / steer). */
  onSendNow?: (item: QueuedMessage) => void;
}

export function QueueList({ queue, onReorder, onRemove, onEdit, onSendNow }: QueueListProps) {
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const handleSort = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const ids = queue.map((i) => i.id);
    const draggedId = ids.splice(dragItem.current, 1)[0];
    ids.splice(dragOverItem.current, 0, draggedId);
    dragItem.current = null;
    dragOverItem.current = null;
    onReorder?.(ids);
  };

  if (queue.length === 0) return null;

  return (
    <div className="max-h-[150px] scrollbar-overlay-container mb-2 space-y-1">
      {queue.map((item, index) => (
        <div
          key={item.id}
          draggable
          onDragStart={() => { dragItem.current = index; }}
          onDragEnter={() => { dragOverItem.current = index; }}
          onDragEnd={handleSort}
          onDragOver={(e) => e.preventDefault()}
          className="flex items-center gap-2 px-2 py-1.5 bg-paper border border-ink/10 rounded shadow-sm text-xs group hover:border-ink/30 transition-colors"
        >
          <div className="cursor-grab text-ink/40 group-hover:text-ink/80">
            <GripVertical size={14} />
          </div>
          <span className="shrink-0 text-[9px] font-mono uppercase tracking-wider px-1 py-px rounded bg-ink/10 text-ink/70">
            follow-up
          </span>
          <div className="flex-1 truncate text-ink/80 pr-2">
            {item.text || (item.attachments.length > 0 ? `[${item.attachments.length} attachment${item.attachments.length > 1 ? 's' : ''}]` : 'Empty message')}
          </div>
          {onSendNow && (
            <button
              onClick={() => onSendNow(item)}
              className="touch-visible text-ink/40 hover:text-ink/80 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Send Now (Steering)"
            >
              <Send size={12} />
            </button>
          )}
          {onEdit && (
            <button
              onClick={() => onEdit(item)}
              className="touch-visible text-ink/40 hover:text-ink/80 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Edit"
            >
              <Pencil size={12} />
            </button>
          )}
          {onRemove && (
            <button
              onClick={() => onRemove(item.id)}
              className="touch-visible text-ink/40 hover:text-error opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
