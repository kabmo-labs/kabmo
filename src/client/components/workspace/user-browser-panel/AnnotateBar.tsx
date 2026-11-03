/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The annotation bar: which tool, what you are saying, and the two exits.
 *
 * It sits above the page rather than in the toolbar because the note belongs to
 * the mark the user just drew — a note field in the address bar would be a
 * second place to type about the same thing. The bar also spells out the limit
 * the panel cannot hide: the page is the user's own cross-origin frame, so no
 * screenshot exists and the mark travels as coordinates.
 */

import { Send, Trash2, X } from 'lucide-preact';
import { ANNOTATE_TOOL_LABEL } from '@/shared/lib/browser/annotate';
import type { AnnotateShape, AnnotateTool } from '@/shared/types';

interface AnnotateBarProps {
  tool: AnnotateTool;
  shapes: AnnotateShape[];
  selectedId: string | null;
  onTool: (tool: AnnotateTool) => void;
  onNote: (id: string, note: string) => void;
  onRemove: (id: string) => void;
  onReset: () => void;
  onCancel: () => void;
  onSend: () => void;
}

const TOOLS: AnnotateTool[] = ['box', 'pin', 'arrow'];

const TOOL_BUTTON =
  'px-2 py-1 rounded text-[11px] font-mono border transition-colors cursor-pointer';
const ACTION_BUTTON =
  'flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-ink/15 hover:border-ink/40 text-ink/80 hover:text-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

export function AnnotateBar({
  tool,
  shapes,
  selectedId,
  onTool,
  onNote,
  onRemove,
  onReset,
  onCancel,
  onSend,
}: AnnotateBarProps) {
  const selected = shapes.find((shape) => shape.id === selectedId) ?? null;
  const usable = shapes.length > 0;

  return (
    <div className="flex-shrink-0 border-b border-ink/10 bg-paper px-2.5 py-1.5 space-y-1.5 select-none">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase font-mono text-ink/50 mr-1">Anotasi</span>
        {TOOLS.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => onTool(entry)}
            aria-pressed={tool === entry}
            className={`${TOOL_BUTTON} ${tool === entry ? 'bg-ink text-canvas border-ink' : 'bg-canvas text-ink/70 border-ink/15 hover:border-ink/40'}`}
          >
            {ANNOTATE_TOOL_LABEL[entry]}
          </button>
        ))}
        <span className="text-[11px] font-mono text-ink/45 ml-1">
          {shapes.length > 0 ? `${shapes.length} tanda` : 'tarik di halaman untuk menandai'}
        </span>
        <div className="flex-1" />
        <button type="button" onClick={onReset} disabled={!usable} className={ACTION_BUTTON} title="Hapus semua tanda">
          <Trash2 size={12} /> Bersihkan
        </button>
        <button type="button" onClick={onSend} disabled={!usable} className={ACTION_BUTTON} title="Kirim anotasi ke draft chat">
          <Send size={12} /> Kirim ke chat
        </button>
        <button type="button" onClick={onCancel} className={ACTION_BUTTON} title="Tutup mode anotasi">
          <X size={12} />
        </button>
      </div>

      <div className="flex items-start gap-1.5">
        {selected ? (
          <>
            <span className="text-[11px] font-mono text-ink/45 pt-1 flex-shrink-0">
              {ANNOTATE_TOOL_LABEL[selected.tool]} #{shapes.indexOf(selected) + 1}
            </span>
            <textarea
              value={selected.note}
              onInput={(event) => onNote(selected.id, event.currentTarget.value)}
              placeholder="Apa yang salah di bagian ini? (mis. tombol Bayar terlihat nonaktif)"
              rows={2}
              className="flex-1 min-w-0 resize-y bg-canvas border border-ink/15 rounded px-2 py-1 text-[11px] font-mono text-ink placeholder:text-ink/35 focus:outline-none focus:border-ink/40"
            />
            <button type="button" onClick={() => onRemove(selected.id)} className={ACTION_BUTTON} title="Hapus tanda ini">
              <Trash2 size={12} />
            </button>
          </>
        ) : (
          <p className="text-[11px] text-ink/45">
            Halaman ini tidak bisa di-screenshot (iframe milik user) — yang dikirim adalah area + catatanmu.
          </p>
        )}
      </div>
    </div>
  );
}
