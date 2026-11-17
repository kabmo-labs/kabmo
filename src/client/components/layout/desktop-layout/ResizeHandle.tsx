import { useRef } from 'preact/hooks';
import { Separator } from '@/client/components/layout/desktop-layout/resizer';
import { usePointerHover } from '@/client/hooks/ui/pointer-hover';

/**
 * Hairline drag handle shared by both resizable groups in the desktop layout.
 *
 * The hover state is driven by pointer events, not `group-hover`: a CSS
 * `:hover` on a 3px separator can stay applied after the pointer has left it
 * (the browser only recomputes it on the next move, and a panel width
 * transition moves the separator under a stationary cursor). The reported
 * symptom was a line that stayed lit until the pointer was moved back over it
 * and away again.
 */
export function ResizeHandle() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const hovered = usePointerHover(hostRef);

  return (
    <Separator
      hostRef={hostRef}
      className="relative w-[3px] outline-none group flex justify-center cursor-col-resize z-10"
    >
      <div
        className={`h-full transition-all group-active:bg-ink/60 group-active:w-[3px] ${
          hovered ? 'w-[3px] bg-ink/40' : 'w-[1px] bg-ink/10'
        }`}
      />
    </Separator>
  );
}
