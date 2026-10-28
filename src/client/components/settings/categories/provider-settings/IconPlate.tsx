import { ProviderIcon } from '@/client/components/common/provider-icon';
import type { ProviderItem } from '@/shared/types';

interface ProviderIconPlateProps {
  provider: Pick<ProviderItem, 'icon' | 'slug' | 'name'>;
  /** Outer box, in px. The mark inside is sized from it. */
  size: number;
  /** Corner radius, in px. Defaults to a quarter of the box. */
  radius?: number;
  className?: string;
}

/**
 * A provider's mark on a rounded plate.
 *
 * The plate is what makes a list of providers readable: without it the marks
 * have no consistent BOX — a brand SVG is square while the initials fallback is
 * a pill whose width follows its text (`t.` is narrower than `ti.`) — so every
 * row's name started at a different x and the column of names, dots and counts
 * came out ragged. A fixed-size plate gives all three a shared origin.
 *
 * `currentColor` is inherited, so the mark keeps following the theme; the plate
 * adds only a hairline and a wash of the row's own ink, never a brand colour.
 *
 * The mark is drawn BOUNDED (`ProviderIcon`'s `bounded` mode) and `overflow` is
 * hidden as a second line of defence: the initials fallback is a pill whose
 * width follows its text, and unbounded it measured ~25px wide inside a 20px
 * content box — visible spill past the rounded edge. Both shapes are now sized
 * from the plate's own content box.
 */
export function ProviderIconPlate({ provider, size, radius, className = '' }: ProviderIconPlateProps) {
  // 12% per side: enough that a brand mark does not touch the hairline, and
  // enough room that the initials badge is legible at list scale. The mark is
  // `bounded`, so neither shape can grow past this box.
  const inset = Math.max(1, Math.round(size * 0.12));
  const markSize = Math.max(10, size - inset * 2);
  return (
    <span
      aria-hidden="true"
      className={`inline-flex flex-shrink-0 items-center justify-center overflow-hidden border border-ink/10 bg-ink/5 text-ink/80 ${className}`}
      style={{ width: size, height: size, borderRadius: radius ?? Math.round(size * 0.28) }}
    >
      <ProviderIcon
        icon={provider.icon}
        slug={provider.slug}
        name={provider.name}
        size={markSize}
        bounded
      />
    </span>
  );
}
