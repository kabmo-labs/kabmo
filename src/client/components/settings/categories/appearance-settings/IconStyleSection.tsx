/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Appearance → Layout → Icons.
 *
 * The card has to answer the question the setting actually raises — "what
 * changes when I pick full colour?" — and the answer now covers three families,
 * so both miniatures draw the same SAMPLE of all three: two functional glyphs
 * (one signal, one neutral), one provider mark and one file-type mark. A preview
 * that showed only logos would under-sell the setting; one that showed only
 * glyphs would hide the part users notice most.
 *
 * The previews are FIXED per card rather than rendered through the live
 * components: those paint from the document attribute, so both cards would show
 * the user's current choice and neither would preview its own. The colour values
 * come from the SAME tables and formula the stylesheet uses (`ICON_TINT_TOKENS`,
 * `iconHueColor`, `BRAND_COLORS`, `FILE_BRAND_COLORS`), so a preview cannot
 * promise a look the shell does not ship.
 */

import { Check, Trash2, Sparkles } from 'lucide-preact';
import type { ComponentType } from 'preact/compat';
import type { SettingsState } from '@/shared/types';
import {
  ICON_STYLES,
  ICON_STYLE_COPY,
  resolveIconStyle,
  type IconStyle,
} from '@/shared/lib/theme/icon-style';
import { BRAND_COLORS } from '@/shared/lib/models/provider/brand-color';
import { FILE_BRAND_COLORS } from '@/shared/lib/icons/file-brand-color';
import { ICON_TINT_TOKENS, iconHue, iconHueColor, iconTintRole } from '@/shared/lib/icons/tint';

interface IconStyleSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((previous: SettingsState) => SettingsState)) => void;
}

/** One functional glyph, painted the way the chosen mode would paint it. */
function GlyphSample({ name, Icon, colored }: { name: string; Icon: typeof Check; colored: boolean }) {
  const role = iconTintRole(name);
  // The role wins over the hue, exactly as the stylesheet orders its rules.
  // Same formula as the stylesheet's light paint, through the same helper: the
  // sample reads the hue table and the ONE saturation/lightness pair.
  const color = !colored
    ? undefined
    : role
      ? ICON_TINT_TOKENS[role]
      : iconHueColor(iconHue(name), 'light');
  return <Icon size={13} strokeWidth={2} style={color ? { color } : undefined} aria-hidden="true" />;
}

/** A brand mark as a dot on a plate, in the mode's paint. */
function BrandSample({ name, base, colored }: { name: string; base: string; colored: boolean }) {
  const color = colored ? base : undefined;
  return (
    <span
      className="flex h-5 w-5 items-center justify-center rounded-[5px] border border-ink/10"
      style={color ? { backgroundColor: `${color}22`, color } : undefined}
      title={name}
      aria-hidden="true"
    >
      <span
        className={`block h-2 w-2 rounded-full ${colored ? '' : 'bg-ink/60'}`}
        style={color ? { backgroundColor: color } : undefined}
      />
    </span>
  );
}

function Miniature({ colored }: { colored: boolean }) {
  return (
    <span className="flex h-full items-center gap-1.5 rounded-md border border-ink/10 bg-canvas/60 px-2">
      <GlyphSample name="Trash2" Icon={Trash2} colored={colored} />
      <GlyphSample name="Check" Icon={Check} colored={colored} />
      <GlyphSample name="Sparkles" Icon={Sparkles} colored={colored} />
      <span className="mx-0.5 h-4 w-px bg-ink/10" />
      <BrandSample name="claude" base={BRAND_COLORS.claude.light} colored={colored} />
      <BrandSample name="Typescript" base={FILE_BRAND_COLORS.Typescript.light} colored={colored} />
    </span>
  );
}

const MINIATURES: Record<IconStyle, ComponentType> = {
  monochrome: () => <Miniature colored={false} />,
  color: () => <Miniature colored />,
};

export function IconStyleSection({ settings, onUpdate }: IconStyleSectionProps) {
  const selected = resolveIconStyle(settings.iconStyle);

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-ink">Icons</h4>
        <p className="mt-0.5 text-[11px] text-ink/50">
          Every icon: toolbar and panel glyphs, provider logos and file-type marks. Full colour
          gives each glyph its own hue and keeps the palette’s red, green, amber and blue for
          signals; a colour that would disappear on the active theme falls back to the ink. A
          control that sets its own colour keeps it.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" role="group" aria-label="Icon style">
        {ICON_STYLES.map((style) => {
          const copy = ICON_STYLE_COPY[style];
          const isSelected = style === selected;
          const MiniatureView = MINIATURES[style];
          return (
            <button
              key={style}
              type="button"
              onClick={() => onUpdate({ iconStyle: style })}
              aria-pressed={isSelected}
              aria-label={`${copy.label} icons — ${copy.description}`}
              className={`flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors cursor-pointer ${
                isSelected
                  ? 'border-ink/40 bg-ink/5'
                  : 'border-ink/15 bg-paper hover:border-ink/30 hover:bg-ink/5'
              }`}
            >
              <span className="block h-[42px]">
                <MiniatureView />
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-ink">{copy.label}</span>
                <span className="font-mono text-[10px] text-ink/40">{copy.caption}</span>
                {isSelected && (
                  <span className="ml-auto rounded-full bg-ink px-1.5 py-[1px] text-[9px] font-semibold text-paper">
                    active
                  </span>
                )}
              </span>
              <span className="text-[11px] leading-relaxed text-ink/60">{copy.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
