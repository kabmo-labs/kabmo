/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pictures a tool result returned, as a strip of thumbnails under the
 * panel's own blocks, with the full-size view behind a click.
 *
 * An `eval` that drives the browser answers with `tab.screenshot()`'s image
 * block beside its text, and the text names a temp file the panel cannot read
 * (`/var/folders/…/omp-sshots-….png` is outside the browse scope). The bytes
 * are in the result itself — inline, or as a `blob:sha256:` reference the
 * server resolves — so the card paints them instead of pointing at the path.
 *
 * More than one picture becomes a CAROUSEL, not a wrapping grid: a browser
 * script routinely captures a dozen frames, and a grid of them pushed the
 * result text off the card. The track is a native horizontal scroller with
 * scroll-snap, so a phone swipes it and a desktop gets the same motion from the
 * arrows; the counter is the only thing that says where in the set you are.
 *
 * The full-size view is the app's existing picture surface (`ImageViewer`,
 * zoom/pan and fit) inside the existing dialog shell (`Modal`), not a third
 * lightbox: a second copy of that interaction is how two viewers drift.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { Camera, ChevronLeft, ChevronRight } from 'lucide-preact';
import type { ToolImageRef } from '@/shared/types/chat';
import { toolImageSrc } from '@/shared/lib/omp/session/tool-images';
import { Modal } from '@/client/components/common/Modal';
import { ImageViewer } from '@/client/components/common/image-viewer';

interface ToolScreenshotsProps {
  /** Every image block the result carried, in result order. */
  images: ToolImageRef[];
}

/** One picture with a URL the browser can paint. */
interface Picture {
  src: string;
  /** 1-based position in the result, for the label and the dialog title. */
  position: number;
}

/** One slide plus the gap after it — the distance a snap step covers. */
function snapStep(track: HTMLElement | null): number {
  const first = track?.firstElementChild as HTMLElement | null;
  if (!track || !first) return 0;
  const gap = Number.parseFloat(getComputedStyle(track).columnGap || '0') || 0;
  return first.offsetWidth + gap;
}

export function ToolScreenshots({ images }: ToolScreenshotsProps) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [overflowing, setOverflowing] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const pictures: Picture[] = [];
  for (const [index, image] of images.entries()) {
    const src = toolImageSrc(image);
    if (src) pictures.push({ src, position: index + 1 });
  }
  const carousel = pictures.length > 1;

  // Arrows are only honest when there is something off-screen to reach: three
  // small captures fit a wide card, and a control that scrolls nothing reads
  // as broken. `clientWidth === 0` means no layout engine has measured the
  // track yet (a collapsed card, a non-visual host) — the control stays.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !carousel) return;
    const measure = (): void => {
      setOverflowing(track.clientWidth === 0 || track.scrollWidth > track.clientWidth + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [carousel, pictures.length]);

  if (pictures.length === 0) return null;

  const open = openAt === null ? undefined : pictures[openAt];

  const goTo = (index: number): void => {
    const track = trackRef.current;
    const clamped = Math.max(0, Math.min(pictures.length - 1, index));
    setActive(clamped);
    if (!track) return;
    const left = clamped * snapStep(track);
    // happy-dom (and any non-visual host) has no smooth scroller; the counter
    // is already correct either way, so the jump is only a fallback.
    if (typeof track.scrollTo === 'function') track.scrollTo({ left, behavior: 'smooth' });
    else track.scrollLeft = left;
  };

  /** The slide nearest the track's own left edge is the one being read. */
  const onScroll = (): void => {
    const track = trackRef.current;
    const width = snapStep(track);
    if (!track || width <= 0) return;
    const index = Math.round(track.scrollLeft / width);
    setActive(Math.max(0, Math.min(pictures.length - 1, index)));
  };

  const slide = (picture: Picture, index: number) => (
    <button
      key={`${index}-${picture.src}`}
      type="button"
      onClick={() => setOpenAt(index)}
      title={`Screenshot ${picture.position} — open full size`}
      className="group w-full cursor-pointer overflow-hidden rounded-md border border-ink/8 bg-canvas/60 transition-colors hover:border-ink/20"
    >
      <img
        src={picture.src}
        alt={`Screenshot ${picture.position}`}
        loading="lazy"
        className="h-40 w-full object-contain object-top"
      />
    </button>
  );

  return (
    <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper">
      <div className="flex items-center gap-1.5 border-b border-ink/6 bg-canvas/30 px-3 py-1.5">
        <Camera size={11} className="text-ink/50" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/50">
          Screenshots
        </span>
        <span className="rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[10px] text-ink/50">
          {carousel && overflowing ? `${active + 1} / ${pictures.length}` : pictures.length}
        </span>

        {carousel && overflowing && (
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => goTo(active - 1)}
              disabled={active === 0}
              aria-label="Previous screenshot"
              className="cursor-pointer rounded p-0.5 text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft size={13} />
            </button>
            <button
              type="button"
              onClick={() => goTo(active + 1)}
              disabled={active === pictures.length - 1}
              aria-label="Next screenshot"
              className="cursor-pointer rounded p-0.5 text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        )}
      </div>

      {carousel ? (
        <div
          ref={trackRef}
          onScroll={onScroll}
          className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto p-1"
        >
          {pictures.map((picture, index) => (
            // The cell owns the width and the gap (its own padding), so the
            // snap step is exactly one cell and no arbitrary `calc()` is
            // needed: two cells fill the track, the third is off-screen.
            <div key={`${index}-${picture.src}`} className="w-full shrink-0 snap-start p-1 sm:w-1/2">
              {slide(picture, index)}
            </div>
          ))}
        </div>
      ) : (
        <div className="p-2">{pictures.map(slide)}</div>
      )}

      {open && (
        <Modal
          onClose={() => setOpenAt(null)}
          maxWidthClass="max-w-4xl"
          ariaLabel={`Screenshot ${open.position} of ${pictures.length}`}
          header={
            <span className="font-mono text-[11px] text-ink/70">
              Screenshot {open.position} of {pictures.length}
            </span>
          }
        >
          <div className="h-[70vh] w-full">
            <ImageViewer src={open.src} name={`Screenshot ${open.position}`} />
          </div>
        </Modal>
      )}
    </div>
  );
}
