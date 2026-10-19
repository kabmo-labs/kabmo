/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The phone's outline: a floating button that opens the symbol list.
 *
 * The desktop puts the outline in a section of the Files panel, which a phone
 * does not have room for — the drawer and the full-screen editor are separate
 * screens, and a section pinned to the drawer's floor would have no editor to
 * jump into. So the control lives in the EDITOR, as the same floating round
 * button the chat uses for "jump to your message" (`MobileTurnJump`): a
 * tap-sized target over the content, with the list in a sheet.
 *
 * The list is the source's own order, never newest-first: an outline is a map
 * of a document, and a map that reads bottom-up is not one.
 *
 * A row publishes a `LineRevealRequest` — the same store the desktop row uses —
 * so the jump is served by the editor that holds the buffer, and the caret
 * lands on the line the row named even after an edit.
 */

import { useState } from 'preact/hooks';
import { ListTree } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import { OutlineKindIcon, outlineKindLabel } from '@/client/components/common/outline-kind-icon';
import { setLineReveal } from '@/client/lib/line-reveal';
import type { OutlineSymbol } from '@/shared/lib/code/outline/types';

interface MobileOutlineButtonProps {
  path: string | null;
  symbols: OutlineSymbol[];
  /** Why there is nothing to list, when `symbols` is empty. */
  emptyNotice: string;
}

export function MobileOutlineButton({ path, symbols, emptyNotice }: MobileOutlineButtonProps) {
  const [open, setOpen] = useState(false);
  if (!path) return null;

  // The name's own span, so the phone selects the identifier the row named
  // rather than parking a caret at the start of its line.
  const pick = (symbol: OutlineSymbol) => {
    setOpen(false);
    setLineReveal({ path, line: symbol.line, column: symbol.column, length: symbol.name.length });
  };

  return (
    <>
      <div className="absolute bottom-14 right-3 z-20">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Outline (${symbols.length} symbols)`}
          title="Outline"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/20 bg-paper text-ink/60 shadow-sm transition-all hover:bg-ink/5 hover:text-ink active:scale-95"
        >
          <ListTree size={16} />
        </button>
      </div>

      {open && (
        <Modal
          onClose={() => setOpen(false)}
          maxWidthClass="max-w-sm"
          zClass="z-[70]"
          header={
            <div className="flex min-w-0 items-center gap-2">
              <ListTree size={15} className="flex-shrink-0 text-ink/50" />
              <span className="text-sm font-medium">Outline</span>
              <span className="font-mono text-[11px] text-ink/40">{symbols.length}</span>
            </div>
          }
        >
          <div className="max-h-[60vh] overflow-y-auto scrollbar-overlay-container py-1">
            {symbols.length === 0 ? (
              <div className="px-4 py-3 text-[11px] italic text-ink/40">{emptyNotice}</div>
            ) : (
              symbols.map((symbol) => (
                <button
                  key={`${symbol.line}:${symbol.kind}:${symbol.name}`}
                  type="button"
                  onClick={() => pick(symbol)}
                  aria-label={`${outlineKindLabel(symbol.kind)} ${symbol.name}, line ${symbol.line}`}
                  className="flex w-full min-w-0 items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-ink/5 active:bg-ink/10"
                  style={{ paddingLeft: `${16 + symbol.depth * 12}px` }}
                >
                  <OutlineKindIcon kind={symbol.kind} size={13} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">{symbol.name}</span>
                  <span className="flex-shrink-0 font-mono text-[10px] text-ink/40">{symbol.line}</span>
                </button>
              ))
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
