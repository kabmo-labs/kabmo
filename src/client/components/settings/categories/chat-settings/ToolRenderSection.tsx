/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How a tool call is drawn in the transcript.
 *
 * Four cards, one per renderer, in the order `TOOL_RENDER_MODES` declares:
 * fullest first. Each card carries a miniature of its own renderer, because the
 * difference between the modes is SHAPE — a label alone cannot show a rail or a
 * status line. The miniature is drawn from the same primitives the transcript
 * uses (a hairline, a dot, a mono line), so the preview is honest about what
 * the reader will get.
 *
 * The copy lives in `shared/lib/chat/timeline/tool-render-mode.ts`, so this
 * file states neither the names nor the descriptions.
 */

import { Check } from 'lucide-preact';
import type { SettingsState } from '@/shared/types';
import {
  TOOL_RENDER_MODE_COPY,
  TOOL_RENDER_MODES,
  type ToolRenderMode,
} from '@/shared/lib/chat/timeline/tool-render-mode';

interface ChatToolRenderSectionProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

/** The miniature per mode. Presentation only — no setting reads it. */
function ModePreview({ mode }: { mode: ToolRenderMode }) {
  if (mode === 'card') {
    return (
      <div aria-hidden className="space-y-1 rounded-md border border-ink/15 bg-paper px-2 py-1.5">
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-ink/50" />
          <span className="h-1 w-10 rounded-full bg-ink/35" />
          <span className="ml-auto h-1 w-5 rounded-full bg-ink/20" />
        </div>
        <div className="h-1 w-16 rounded-full bg-ink/15" />
      </div>
    );
  }
  if (mode === 'compact') {
    return (
      <div aria-hidden className="space-y-1.5 rounded-md border border-transparent px-1 py-1">
        {[0, 1].map((row) => (
          <div key={row} className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-ink/40" />
            <span className="h-1 w-8 rounded-full bg-ink/30" />
            <span className="ml-auto h-1 w-6 rounded-full bg-ink/15" />
          </div>
        ))}
      </div>
    );
  }
  if (mode === 'trace') {
    return (
      <div aria-hidden className="relative ml-1 pl-3 py-1">
        <span className="absolute left-[3px] top-1 bottom-1 w-px bg-ink/20" />
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-1 py-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-ink/40" />
            <span className="h-1 w-10 rounded-full bg-ink/25" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div aria-hidden className="space-y-1.5 px-1 py-1">
      <div className="h-1 w-20 rounded-full bg-ink/25" />
      <div className="h-1 w-14 rounded-full bg-ink/15" />
    </div>
  );
}

export function ChatToolRenderSection({ settings, onUpdate }: ChatToolRenderSectionProps) {
  const selected = settings.toolRenderStyle;

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">Tool Calls</h4>
        <p className="text-[11px] text-ink/60 mt-0.5">
          How a tool call is drawn in the transcript. Every style shows the same outcome, facts and body.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {TOOL_RENDER_MODES.map((mode) => {
          const copy = TOOL_RENDER_MODE_COPY[mode];
          const isSelected = selected === mode;
          return (
            <div
              key={mode}
              onClick={() => onUpdate({ toolRenderStyle: mode })}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onUpdate({ toolRenderStyle: mode });
                }
              }}
              className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between select-none ${
                isSelected
                  ? 'border-ink bg-ink/5 ring-1 ring-ink/20 shadow-xs'
                  : 'border-ink/15 bg-paper hover:border-ink/30 hover:bg-ink/[0.02]'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-xs text-ink">{copy.label}</span>
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                      isSelected ? 'border-ink bg-ink text-paper' : 'border-ink/30 bg-transparent'
                    }`}
                  >
                    {isSelected && <Check size={10} strokeWidth={3} />}
                  </div>
                </div>

                <div className="mb-2.5 h-12 rounded-md bg-canvas/50 px-1 py-1">
                  <ModePreview mode={mode} />
                </div>

                <p className="text-[11px] text-ink/65 leading-relaxed">{copy.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-ink/45 font-mono">
        The style is global: it applies to every session, and the composer keeps its own frame.
      </p>
    </section>
  );
}
