import { UploadCloud } from 'lucide-preact';

/**
 * Covers the composer while a file drag hovers it. `pointer-events-none` is
 * load-bearing: the overlay sits above the card, so without it the drop would
 * land on the overlay and never reach the card's own handler.
 */
export function DropOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 rounded-[inherit] border-2 border-dashed border-ink/40 bg-canvas/90 text-ink">
      <UploadCloud size={18} className="text-ink/60" />
      <span className="text-[11px] font-semibold">Drop files to attach</span>
      <span className="text-[10px] text-ink/50">Folders are expanded into their files</span>
    </div>
  );
}
