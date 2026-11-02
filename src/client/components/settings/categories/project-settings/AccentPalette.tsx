/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The project's accent, as a row of swatches plus a custom colour.
 *
 * The palette is one table (`@/shared/lib/workspace/project-accent`) so the
 * picker and the server cannot disagree about which presets exist. A custom
 * accent is NOT a new table entry — it is a stored hex the palette does not
 * contain, and the swatch row treats it as selected so the pane always shows the
 * colour the sidebar is painting.
 *
 * The custom control writes only on COMMIT (the colour input's native `change`,
 * the text field's blur/Enter), never on every `input`: dragging inside the
 * system colour panel fires hundreds of `input`s and each one is a PATCH
 * carrying the whole project.
 *
 * Those two listeners are attached NATIVELY, not through `onChange`/`onInput`
 * props, because `preact/compat` rewrites `onChange` to the `input` event — under
 * it a prop would commit on every drag tick, and the isolation of a test file
 * (where compat may not be loaded yet) is no evidence about the app.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { Pipette, X } from 'lucide-preact';
import {
  DEFAULT_CUSTOM_ACCENT,
  PROJECT_ACCENT_OPTIONS,
  normalizeHexAccent,
} from '@/shared/lib/workspace/project-accent';
import type { AccentColorOption } from '@/shared/types';

interface ProjectAccentPaletteProps {
  accentColor: string;
  onSelectColor: (color: string) => void;
  options?: AccentColorOption[];
  disabled?: boolean;
}

export function ProjectAccentPalette({
  accentColor,
  onSelectColor,
  options = PROJECT_ACCENT_OPTIONS,
  disabled = false,
}: ProjectAccentPaletteProps) {
  const colorList = options.length > 0 ? options : PROJECT_ACCENT_OPTIONS;
  const stored = accentColor.trim().toLowerCase();
  // The palette's `''` entry is "no accent", so an empty accent is the None
  // swatch, not a custom colour.
  const isPreset = colorList.some((opt) => opt.value !== '' && opt.value.toLowerCase() === stored);
  const isCustom = stored !== '' && !isPreset;
  // What the custom control shows: the stored colour when there is one, so the
  // field and the swatches never describe two different accents.
  const current = normalizeHexAccent(stored) ?? DEFAULT_CUSTOM_ACCENT;

  const [draft, setDraft] = useState(current);
  // Follow the stored accent — after a preset is picked, after a PATCH lands,
  // and after one is refused and the row reverts. The initial state already
  // equals `current`, so this never paints a stale value first.
  useEffect(() => setDraft(current), [current]);

  const commit = (value: string) => {
    const normalized = normalizeHexAccent(value);
    if (normalized === null) {
      setDraft(current);
      return;
    }
    // Held until the stored accent catches up: clearing it here would snap the
    // field back to the OLD colour while the PATCH is still in flight.
    setDraft(normalized);
    // Re-typing the colour that is already stored (Escape, then leaving the
    // field) is not an edit; the server would answer `changed: false`.
    if (normalized !== stored) onSelectColor(normalized);
  };

  const colorRef = useRef<HTMLInputElement>(null);
  const hexRef = useRef<HTMLInputElement>(null);
  // The listeners are bound once, so they read the LATEST commit through here
  // instead of capturing the first render's `stored`.
  const latest = useRef({ commit, clear: () => onSelectColor('') });
  latest.current = { commit, clear: () => onSelectColor('') };

  useEffect(() => {
    const color = colorRef.current;
    const hex = hexRef.current;
    if (!color || !hex) return;

    const preview = (event: Event) => setDraft((event.target as HTMLInputElement).value.toLowerCase());
    const settle = (event: Event) => latest.current.commit((event.target as HTMLInputElement).value);
    // `blur`, not `focusout`: it is the event every browser fires when the field
    // loses focus, and it needs no compat mapping to be seen.
    const leaveField = () => {
      const value = hex.value.trim();
      if (value === '') latest.current.clear();
      else latest.current.commit(value);
    };
    const typed = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        leaveField();
      }
      if (event.key === 'Escape') setDraft(current);
    };

    color.addEventListener('input', preview);
    color.addEventListener('change', settle);
    hex.addEventListener('blur', leaveField);
    hex.addEventListener('keydown', typed);
    return () => {
      color.removeEventListener('input', preview);
      color.removeEventListener('change', settle);
      hex.removeEventListener('blur', leaveField);
      hex.removeEventListener('keydown', typed);
    };
  }, [current]);

  return (
    <div className="space-y-2.5">
      <h4 className="text-xs font-semibold text-ink">Accent colour</h4>
      <div className="flex flex-wrap items-center gap-2.5">
        {colorList.map((opt) => {
          const isSelected = stored === opt.value.toLowerCase();

          if (opt.value === '') {
            return (
              <button
                key="none"
                type="button"
                onClick={() => onSelectColor('')}
                disabled={disabled}
                aria-label="No accent colour"
                aria-pressed={isSelected}
                title="No accent colour"
                className={`w-7 h-7 rounded-full border flex items-center justify-center transition-all cursor-pointer disabled:opacity-50 ${
                  isSelected
                    ? 'border-ink bg-ink/10 ring-2 ring-ink/30 ring-offset-2 ring-offset-paper'
                    : 'border-ink/25 bg-paper hover:border-ink/50 text-ink/60'
                }`}
              >
                <X size={12} strokeWidth={2.2} />
              </button>
            );
          }

          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelectColor(opt.value)}
              disabled={disabled}
              aria-label={opt.label}
              aria-pressed={isSelected}
              title={opt.label}
              style={{ backgroundColor: opt.bgHex }}
              className={`w-7 h-7 rounded-full transition-all cursor-pointer shadow-2xs disabled:opacity-50 ${
                isSelected
                  ? 'ring-2 ring-ink ring-offset-2 ring-offset-paper scale-105'
                  : 'hover:scale-105 opacity-90 hover:opacity-100'
              }`}
            />
          );
        })}
      </div>

      <div className="flex items-center gap-2 pt-0.5">
        <label
          title="Pick a custom accent colour"
          className={`relative w-7 h-7 shrink-0 rounded-full border overflow-hidden cursor-pointer transition-all ${
            isCustom ? 'ring-2 ring-ink ring-offset-2 ring-offset-paper' : 'border-ink/25 hover:border-ink/50'
          } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <span aria-hidden="true" className="absolute inset-0" style={{ backgroundColor: draft }} />
          <Pipette
            size={12}
            strokeWidth={2.2}
            aria-hidden="true"
            className="absolute inset-0 m-auto text-white/90 mix-blend-difference pointer-events-none"
          />
          {/* The native picker opens the system colour panel, which is the only
              way to choose a colour without re-implementing a wheel here. */}
          <input
            ref={colorRef}
            type="color"
            value={normalizeHexAccent(draft) ?? DEFAULT_CUSTOM_ACCENT}
            disabled={disabled}
            aria-label="Custom accent colour"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </label>

        <input
          ref={hexRef}
          type="text"
          value={draft}
          disabled={disabled}
          spellcheck={false}
          aria-label="Custom accent colour hex"
          placeholder={DEFAULT_CUSTOM_ACCENT}
          onInput={(event) => setDraft(event.currentTarget.value)}
          className="w-[86px] bg-paper border border-ink/20 rounded-md px-2 py-1 text-[11px] font-mono text-ink outline-none focus:border-ink/60 transition-colors disabled:opacity-50"
        />
        <span className="text-[11px] text-ink/45">{isCustom ? 'Custom accent' : 'Pick any colour'}</span>
      </div>
    </div>
  );
}
