import { useState } from 'preact/hooks';
import { ProviderIcon } from '@/client/components/common/provider-icon';
import type { ProviderItem } from '@/shared/types';

interface ProviderIconPlateProps {
  provider: Pick<ProviderItem, 'icon' | 'slug' | 'name' | 'iconUrl'>;
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
 * **A provider's own web icon wins when it has one**, and it is the only mark
 * drawn in COLOUR: it is the site's own logo (`iconUrl`, fetched from the
 * provider's `baseUrl`), and recolouring it to `currentColor` would turn a
 * brand mark into a silhouette. Everything else in this list stays monochrome
 * on purpose — the app's palette is a paper/ink system, and a table of
 * hand-drawn brand shapes is what made the one coloured logo stand out as an
 * accident rather than as identity.
 *
 * A failed image falls back to the built-in mark: the bytes come from a third
 * party, so a 404 after the fact (the site dropped its favicon) must not leave
 * a broken-image glyph in the row.
 */
export function ProviderIconPlate({ provider, size, radius, className = '' }: ProviderIconPlateProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const inset = Math.max(1, Math.round(size * 0.12));
  const markSize = Math.max(10, size - inset * 2);
  const showWebIcon = Boolean(provider.iconUrl) && !imageFailed;

  return (
    <span
      aria-hidden="true"
      className={`inline-flex flex-shrink-0 items-center justify-center overflow-hidden border border-ink/10 bg-ink/5 text-ink/80 ${className}`}
      style={{ width: size, height: size, borderRadius: radius ?? Math.round(size * 0.28) }}
    >
      {showWebIcon ? (
        <img
          src={provider.iconUrl}
          alt=""
          width={markSize}
          height={markSize}
          loading="lazy"
          decoding="async"
          // `contain`, never `cover`: a wide wordmark would be cropped into an
          // unreadable stripe, and a transparent logo needs no background.
          className="h-full w-full object-contain p-[2px]"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <ProviderIcon
          icon={provider.icon}
          slug={provider.slug}
          name={provider.name}
          size={markSize}
          bounded
        />
      )}
    </span>
  );
}
