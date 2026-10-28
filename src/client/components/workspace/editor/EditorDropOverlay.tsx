import { UploadCloud } from 'lucide-preact';

/**
 * Covers the editor while a file drag hovers it.
 *
 * `pointer-events-none` is load-bearing, the same way it is on the composer's
 * overlay: this sits above the pane, so without it the drop would land on the
 * overlay and never reach the handler that claims the gesture.
 *
 * The wording is deliberately not the composer's ("Drop files to attach") —
 * the same gesture means two different things depending on where it lands, and
 * a user who dropped on the editor expecting an attachment would otherwise have
 * no way to tell which target they were over.
 */
export function EditorDropOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 border-2 border-dashed border-ink/40 bg-canvas/90 text-ink">
      <UploadCloud size={18} className="text-ink/60" />
      <span className="text-[11px] font-semibold">Drop a file to open it</span>
      {/* The old line promised "Inside a workspace the console can read", which
          stopped being true when a drop started granting its own directory
          (`client/lib/fs/resolve-open.ts`) — the file may live anywhere the user
          can reach, and the sentence has to say so or it contradicts the gesture
          that works. */}
      <span className="text-[10px] text-ink/50">Any file this console can read</span>
    </div>
  );
}
