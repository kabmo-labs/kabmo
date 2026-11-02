/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Defaults for new chats" — the model a chat BORN in this project starts on.
 *
 * The value is the composite `provider:modelId` from the live `/api/models`
 * catalog, and it is read by the spawn (`POST /api/agent/new`), so what this
 * control says is what the first prompt actually runs on. It used to offer a
 * hardcoded list of display names ("GPT-4o", "DeepSeek-V3") that nothing ever
 * read: the spawn fell back to Kabmo's global pick, so the field was decorative.
 *
 * "Inherit Kabmo's default" is the empty state, and it is the honest name for
 * what an unset project does.
 */

import { useMemo, useRef, useState } from 'preact/hooks';
import { Check, ChevronDown, Info, Search, Sparkles, X } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import type { ProjectModelChoice } from '@/client/hooks/settings/projects';
import { NO_PROJECT_MODEL, projectModelLabel, projectModelValue } from '@/shared/lib/workspace/project-model';

interface ProjectModelDropdownProps {
  /** Stored `provider:modelId`, or the schema's `Not selected`. */
  model: string;
  models: ProjectModelChoice[];
  onSelectModel: (value: string) => void;
  disabled?: boolean;
}

export function ProjectModelDropdown({
  model,
  models,
  onSelectModel,
  disabled = false,
}: ProjectModelDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useOnClickOutside(dropdownRef, () => setIsOpen(false));

  const label = projectModelLabel(model, models) ?? 'Inherit Kabmo’s default';

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return models;
    return models.filter((entry) =>
      entry.name.toLowerCase().includes(needle)
      || entry.id.toLowerCase().includes(needle)
      || entry.provider.toLowerCase().includes(needle),
    );
  }, [models, search]);

  const pick = (value: string) => {
    onSelectModel(value);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5">
        <h4 className="text-xs font-semibold text-ink">Defaults for new chats</h4>
        <span
          className="inline-flex text-ink/40 hover:text-ink/70 transition-colors cursor-help"
          title="The model a chat started in this project uses until you pick another one in the composer."
        >
          <Info size={12} />
        </span>
      </div>

      <div className="flex items-center justify-between gap-4 p-3 bg-paper border border-ink/15 rounded-lg">
        <div className="min-w-0">
          <div className="text-xs font-medium text-ink">Project model</div>
          <div className="text-[11px] text-ink/50">
            {models.length === 0
              ? 'No model catalog yet — connect a provider first.'
              : 'Applied when the project starts a chat.'}
          </div>
        </div>

        <div className="relative shrink-0" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            disabled={disabled}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-ink/20 hover:border-ink/40 bg-paper text-ink text-xs font-medium transition-colors cursor-pointer shadow-2xs max-w-[248px] disabled:opacity-50"
          >
            <Sparkles size={13} className="text-ink/70 shrink-0" />
            <span className="truncate">{label}</span>
            <ChevronDown size={13} className="text-ink/50 shrink-0" />
          </button>

          {isOpen && (
            <div className="absolute right-0 mt-1 w-[288px] bg-paper border border-ink/15 rounded-lg shadow-xl z-50 overflow-hidden">
              <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-ink/10">
                <Search size={12} className="text-ink/40 shrink-0" />
                <input
                  autoFocus
                  value={search}
                  onInput={(e) => setSearch(e.currentTarget.value)}
                  placeholder="Search models…"
                  className="flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink/35"
                />
              </div>

              <div className="max-h-64 scrollbar-overlay-container py-1">
                <button
                  type="button"
                  onClick={() => pick(NO_PROJECT_MODEL)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-ink/5 transition-colors cursor-pointer"
                >
                  <span className={model === NO_PROJECT_MODEL ? 'font-semibold text-ink' : 'text-ink/80'}>
                    Inherit Kabmo’s default
                  </span>
                  {model === NO_PROJECT_MODEL && <Check size={13} className="text-ink" />}
                </button>

                {filtered.length === 0 ? (
                  <p className="px-3 py-2 text-[11px] text-ink/50">
                    {models.length === 0 ? 'The catalog is empty.' : `No model matches “${search.trim()}”.`}
                  </p>
                ) : (
                  filtered.map((entry) => {
                    const value = projectModelValue({ provider: entry.provider, modelId: entry.id });
                    const isSelected = model === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => pick(value)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-ink/5 transition-colors cursor-pointer"
                      >
                        <span className="min-w-0 flex flex-col">
                          <span className={`truncate text-xs ${isSelected ? 'font-semibold text-ink' : 'text-ink/85'}`}>
                            {entry.name}
                          </span>
                          <span className="truncate text-[10.5px] text-ink/45">{entry.provider}</span>
                        </span>
                        {isSelected && <Check size={13} className="text-ink shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>

              {model !== NO_PROJECT_MODEL && (
                <button
                  type="button"
                  onClick={() => pick(NO_PROJECT_MODEL)}
                  className="w-full flex items-center gap-1.5 px-3 py-2 border-t border-ink/10 text-[11px] text-ink/60 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
                >
                  <X size={11} />
                  <span>Clear the project model</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
