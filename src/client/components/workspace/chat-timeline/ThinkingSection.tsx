/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The thinking accordion, drawn in the same style as the tool rows around it.
 *
 * It used to spell the tool card's frame out itself, so `toolRenderStyle`
 * reached the tool blocks and left thinking sitting in the old card — a setting
 * that half applied. The frame, the header row and the body container now come
 * from `blockChrome` (`shared/lib/chat/timeline/block-chrome.ts`), the one
 * place that states them per style.
 *
 * What is NOT shared, deliberately: this block's own rules. A generating run
 * opens itself, the body follows the tail while it streams, and a notice
 * embedded in the thought renders as its own inset — behaviour that belongs to
 * thinking and to nothing else.
 *
 * The toggle carries `aria-expanded` and no `aria-label`, as it always has:
 * `chat.e2e.ts` collects `[aria-label^="Expand "]` and requires every entry to
 * name a TOOL, so a second block spelling its control that way would be read as
 * a tool card with a title of "Thinking".
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { BrainCircuit, ChevronDown, Sparkles } from 'lucide-preact';
import type { ThinkingData } from '@/shared/types';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { CopyButton } from '@/client/components/common/CopyButton';
import { transcriptGutter } from '@/shared/lib/chat/timeline/gutter';
import { blockChrome, traceInset } from '@/shared/lib/chat/timeline/block-chrome';
import { useToolRenderMode } from '@/client/hooks/chat/timeline/tool-render-mode';

interface ThinkingSectionProps {
  thinking: ThinkingData | string;
  defaultExpanded?: boolean;
  showSeparator?: boolean;
  /** Phone layout: the section's frame is the timeline gutter itself. */
  isMobile?: boolean;
}

export function ThinkingSection({
  thinking,
  defaultExpanded = false,
  showSeparator = false,
  isMobile = false,
}: ThinkingSectionProps) {
  const mode = useToolRenderMode();
  const chrome = blockChrome(mode);
  const framed = mode === 'card';

  const isGenerating = typeof thinking === 'object' ? Boolean(thinking.isGenerating) : false;
  const [isOpen, setIsOpen] = useState(defaultExpanded || isGenerating);
  const thoughtBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isGenerating) setIsOpen(true);
  }, [isGenerating]);

  const thoughtText = typeof thinking === 'string' ? thinking : thinking.thought || '';
  const noticeMatch = thoughtText.match(/<system-notice[^>]*>([\s\S]*?)<\/system-notice>/);
  const noticeText = noticeMatch?.[1]?.trim() ?? '';
  const cleanThought = thoughtText.replace(/<system-notice[^>]*>[\s\S]*?<\/system-notice>/g, '').trim();
  const duration = typeof thinking === 'object' ? thinking.duration : undefined;
  const summary = typeof thinking === 'object' && thinking.summary
    ? thinking.summary
    : cleanThought.slice(0, 100) + (cleanThought.length > 100 ? '...' : '');

  useEffect(() => {
    if (!isOpen || !isGenerating) return;
    const el = thoughtBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [isOpen, cleanThought, isGenerating]);

  const toggleOpen = () => setIsOpen(prev => !prev);

  if (!cleanThought) return null;

  const iconTone = framed ? 'bg-ink/5 text-ink/70' : 'text-ink/40';

  return (
    <div className={`${transcriptGutter(isMobile)} ${showSeparator ? 'space-y-1.5' : ''}`}>
      {showSeparator && (
        <div className={`flex items-center gap-2 px-1 pt-0.5 ${traceInset(mode, isMobile)}`}>
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink/35">
            Thinking
          </span>
          <span className="h-px flex-1 bg-ink/8" />
        </div>
      )}
      <div className={chrome.root || undefined}>
        {/* The rail is drawn once per TURN by `TurnRail`; this block only places
            its node. `trace` is the one style with a node. */}
        {mode === 'trace' && <span aria-hidden="true" className={chrome.node} />}
        <div className={chrome.frame || undefined}>
          <button
            type="button"
            onClick={toggleOpen}
            aria-expanded={isOpen}
            className={`${chrome.header} cursor-pointer select-none ${
              framed ? 'hover:bg-ink/[0.03]' : 'hover:bg-ink/[0.03] rounded-md'
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20`}
          >
            <span className={`${chrome.icon} ${iconTone}`}>
              <Sparkles size={13} />
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className={chrome.title}>Thinking</span>
              {isGenerating && <span className="h-1.5 w-1.5 rounded-full bg-ink/60 animate-pulse" />}
              {!isOpen && (
                <>
                  {!framed && <span className="text-ink/25">—</span>}
                  <span className={`${chrome.subtitle} ${framed ? '' : 'flex-1'}`}>{summary}</span>
                </>
              )}
            </span>
            {duration && (
              <span className="shrink-0 rounded-full bg-ink/5 px-2 py-0.5 font-mono text-[10px] text-ink/50">
                {duration}
              </span>
            )}
            <ChevronDown
              size={14}
              className={`shrink-0 text-ink/35 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {isOpen && (
            <div className={chrome.body}>
              <div className="flex items-center justify-between pb-1.5">
                <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink/40">
                  Model Reasoning & Strategy
                </span>
                <CopyButton
                  text={cleanThought}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
                  title="Copy thinking"
                  wrapLabel
                  label="Copy"
                />
              </div>

              {noticeText && (
                <div className="mb-2 flex items-start gap-2.5 rounded-lg border border-ink/15 bg-paper px-3 py-2.5">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink/10">
                    <BrainCircuit size={13} className="text-ink/70" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-ink/50">
                      System Notice
                    </div>
                    <div className="text-[12px] leading-relaxed text-ink/85">
                      <MarkdownRenderer content={noticeText} className="text-[12px] text-ink/85 leading-relaxed" />
                    </div>
                  </div>
                </div>
              )}

              <div
                ref={thoughtBodyRef}
                className="max-h-72 overflow-auto border-l-2 border-ink/15 py-1 pl-3 text-ink/80 scrollbar-overlay-container select-text"
              >
                <MarkdownRenderer
                  content={cleanThought}
                  className="text-[12px] leading-relaxed text-ink/85 [&_.code-block]:my-2 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
