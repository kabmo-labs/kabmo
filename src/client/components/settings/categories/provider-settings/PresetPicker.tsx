import { useMemo, useState } from 'preact/hooks';
import { Check, ChevronDown, Search } from 'lucide-preact';
import type { PresetProviderOption } from '@kabmo-labs/kabmo-settings-contracts/provider';
import { groupProviderPresets } from '@/shared/lib/models/provider/presets';
import { matchesPickerQuery } from '@/shared/lib/ui/picker-filter';
import { ProviderIconPlate } from '@/client/components/common/provider-icon/Plate';

interface PresetPickerProps {
  presets: PresetProviderOption[];
  selectedPresetId: string;
  onSelectPreset: (preset: PresetProviderOption) => void;
}

/**
 * The provider picker, grouped by kind.
 *
 * Groups matter because the presets are not interchangeable: a local engine is
 * keyless and discovered by omp, a gateway is fetched and written into
 * models.yml, and an "Other dialects" entry exists precisely because the
 * endpoint is NOT OpenAI-shaped. Listing them in one flat grid made a keyless
 * Ollama row look like a hosted API that would ask for a key.
 *
 * The catalog grows with every provider omp learns, so it is SEARCHED like the
 * app's other catalogs rather than scrolled; the groups keep the order the
 * source gave them.
 */
export function PresetPicker({ presets, selectedPresetId, onSelectPreset }: PresetPickerProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');

  const visible = useMemo(
    () => presets.filter((preset) => matchesPickerQuery(`${preset.name} ${preset.slug} ${preset.group}`, query)),
    [presets, query],
  );
  const groups = groupProviderPresets(visible);

  if (presets.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-ink/50">
        Every known provider is already configured.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 rounded-lg border border-ink/15 bg-paper px-2 py-1.5">
        <Search size={12} className="shrink-0 text-ink/40" />
        <input
          type="text"
          value={query}
          onInput={(event) => setQuery(event.currentTarget.value)}
          aria-label="Search providers"
          placeholder="Search providers…"
          className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink/35"
        />
      </div>

      <div className="max-h-52 scrollbar-overlay-container pr-1 space-y-2">
        {groups.length === 0 ? (
          <p className="px-2 py-3 text-xs italic text-ink/40">No match for “{query.trim()}”</p>
        ) : null}

        {groups.map((entry) => {
          const isCollapsed = collapsed[entry.group] === true;
          return (
            <div key={entry.group}>
              <button
                type="button"
                onClick={() => setCollapsed((prev) => ({ ...prev, [entry.group]: !isCollapsed }))}
                className="w-full flex items-center gap-1.5 px-0.5 py-1 text-[10px] font-semibold tracking-wider text-ink/50 uppercase hover:text-ink/80 transition-colors cursor-pointer"
              >
                <ChevronDown
                  size={11}
                  className={`transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                />
                <span>{entry.group}</span>
                <span className="text-ink/30 normal-case tracking-normal">{entry.options.length}</span>
              </button>

              {!isCollapsed && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {entry.options.map((preset) => {
                    const isSelected = preset.id === selectedPresetId;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => onSelectPreset(preset)}
                        title={preset.defaultUrl}
                        className={`flex items-center gap-2 p-2 rounded-lg border text-left text-xs transition-colors cursor-pointer ${
                          isSelected
                            ? 'border-ink/50 bg-ink/5 font-semibold text-ink shadow-2xs'
                            : 'border-ink/15 hover:border-ink/30 text-ink/70'
                        }`}
                      >
                        <ProviderIconPlate
                          provider={{ icon: preset.icon, slug: preset.slug, name: preset.name }}
                          size={18}
                        />
                        <span className="truncate flex-1">{preset.name}</span>
                        {isSelected && <Check size={12} className="shrink-0 text-ink" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
