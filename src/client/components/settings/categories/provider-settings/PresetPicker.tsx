import { useState } from 'preact/hooks';
import { Check, ChevronDown } from 'lucide-preact';
import type { PresetProviderOption } from '@/shared/types/settings/provider';
import { groupProviderPresets } from '@/shared/lib/models/provider/presets';
import { ProviderIcon } from '@/client/components/common/provider-icon';

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
 */
export function PresetPicker({ presets, selectedPresetId, onSelectPreset }: PresetPickerProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const groups = groupProviderPresets(presets);

  if (presets.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-ink/50">
        Every known provider is already configured.
      </p>
    );
  }

  return (
    <div className="max-h-52 scrollbar-overlay-container pr-1 space-y-2">
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
                      <ProviderIcon icon={preset.icon} slug={preset.slug} name={preset.name} size={14} />
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
  );
}
