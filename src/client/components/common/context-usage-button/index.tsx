/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The context-usage control both layouts draw: a ring filled clockwise with the
 * share of the model's window in use, and a popover with the numbers behind it.
 *
 * ONE component, because the two layouts used to disagree — the phone had this
 * control and the desktop navbar did not, so the only way to see how close a run
 * was to its window on a desktop was to open the Context panel in the right
 * column. A second copy of the popover is also how the two would drift: the
 * provider/model split below is the kind of detail one copy gets and the other
 * forgets.
 *
 * The popover hangs under the trigger on both layouts, from the rectangle
 * captured where the click happened; `layout` decides only the trigger's box.
 * The phone used to pin the panel to the title bar's inset instead, which put it
 * over the header and at the far side of the screen from the ring that opened
 * it.
 *
 * The panel is drawn by `common/anchored-menu/` — portalled into `document.body`
 * at `z-[70]`. It used to be a `fixed z-50` child of the header, and BOTH headers
 * are flex items at `z-20`: a `z-50` inside that stacking context is still
 * `z-20` against its siblings, so the phone's floating "jump to your message"
 * button (a `z-20` later in the DOM, sitting exactly where this panel opens)
 * painted over the panel's header and first rows. Raising the panel's own number
 * cannot help; the number that decides is the ANCESTOR's. Same defect, same
 * remedy, as `common/server-control/Panel.tsx`.
 */

import { useCallback, useMemo, useState } from 'preact/hooks';
import type { TargetedMouseEvent } from 'preact';
import { AnchoredMenu } from '@/client/components/common/anchored-menu';
import { anchorRectOf, type AnchorRect } from '@/shared/lib/ui/menu-anchor';
import { useSessionContextTelemetry } from '@/client/hooks/chat/context/telemetry';
import { useModelNames } from '@/client/hooks/models/use-model-names';
import { useProviderNames } from '@/client/hooks/models/use-provider-names';
import { providerLabel } from '@/shared/lib/models/provider/label';
import { formatCompactTokens } from '@/shared/lib/format/number';
import { CONTEXT_BAND_TONES, contextUsageBand } from '@/shared/lib/chat/context/usage';
import { ContextRing } from '@/client/components/common/context-usage-button/Ring';
import { McpSection } from '@/client/components/common/context-usage-button/McpSection';
import { CONTROL_BOX } from '@/client/lib/ui/control-plate';

interface ContextUsageButtonProps {
  sessionId: string | null;
  /** `mobile` changes only the trigger's box; the panel hangs off it either way. */
  layout?: 'desktop' | 'mobile';
}

export function ContextUsageButton({ sessionId, layout = 'desktop' }: ContextUsageButtonProps) {
  const { telemetry, percent } = useSessionContextTelemetry(sessionId);
  const [open, setOpen] = useState(false);
  // Captured at the click, from the button that was pressed: the panel hangs
  // under it on both layouts. The phone used to pin it to the title bar's
  // inset, which put it over the header and at the far side of the screen from
  // the ring the user had just tapped.
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setAnchor(null);
  }, []);

  // The telemetry reports the model as `provider/modelId` (omp's own selector).
  // Split once here so the popover prints the provider and the model on separate
  // lines and resolves each to its display name — the raw slug reads as
  // "kenari-jatis/deepseek-v4-1-flash", which names neither the vendor nor the
  // model as the user picked them.
  const providerNames = useProviderNames();
  const modelNames = useModelNames();
  const { providerName, modelName } = useMemo(() => {
    const selector = telemetry?.modelId ?? '';
    const slash = selector.indexOf('/');
    if (slash <= 0) return { providerName: selector, modelName: '' };
    return {
      providerName: providerLabel(selector.slice(0, slash), providerNames),
      modelName: modelNames[selector.slice(slash + 1)] ?? selector.slice(slash + 1),
    };
  }, [telemetry?.modelId, providerNames, modelNames]);

  const started = Boolean(telemetry && telemetry.messagesCount > 0);
  const band = contextUsageBand(percent);
  const triggerClass = layout === 'mobile'
    ? `${CONTROL_BOX.mobile} hover:bg-ink/5 active:bg-ink/10 transition-colors cursor-pointer`
    : `${CONTROL_BOX.desktop} hover:bg-ink/10 transition-colors cursor-pointer`;

  return (
    <>
      <button
        type="button"
        onClick={(event: TargetedMouseEvent<HTMLButtonElement>) => {
          event.stopPropagation();
          if (open) {
            close();
            return;
          }
          setAnchor(anchorRectOf(event.currentTarget));
          setOpen(true);
        }}
        className={triggerClass}
        title={started ? `Context usage: ${percent.toFixed(0)}% of the window` : 'Context usage: session not started'}
        aria-label="Context usage"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {/* The ring keeps its own 18px: it is a dial, not a glyph, and it reads
            smaller than a stroke icon at the same box. */}
        <ContextRing percent={percent} />
      </button>

      {open && (
        <AnchoredMenu
          anchor={anchor}
          role="dialog"
          ariaLabel="Context usage"
          className="w-72 bg-paper border border-ink/20 rounded-xl shadow-xl p-3 text-xs font-mono"
          onClose={close}
        >
          <div className="font-semibold text-ink font-sans pb-1.5 border-b border-ink/10 flex items-center justify-between">
            <span>Context</span>
            {started && (
              <span className={`w-1.5 h-1.5 rounded-full ${CONTEXT_BAND_TONES[band].fill}`} />
            )}
          </div>
          {!started || !telemetry ? (
            <div className="pt-2 text-[11px] text-ink/50 italic font-sans">Session not started</div>
          ) : (
            <div className="pt-2 space-y-1.5 text-[11px] text-ink/80">
              <div className="flex justify-between gap-2">
                <span className="text-ink/50 flex-shrink-0">Provider:</span>
                <span className="truncate text-right">{providerName || '–'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-ink/50 flex-shrink-0">Model:</span>
                <span className="truncate text-right">{modelName || '–'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/50">Context:</span>
                <span>
                  {formatCompactTokens(telemetry.contextUsed) ?? '0'} / {formatCompactTokens(telemetry.contextLimit) ?? '0'} ({percent}%)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/50">Messages:</span>
                <span>{telemetry.messagesCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/50">Cost:</span>
                <span>{telemetry.costFormatted}</span>
              </div>
              {typeof telemetry.cacheHitAverage === 'number' && (
                <div className="flex justify-between">
                  <span className="text-ink/50">Cache hit:</span>
                  <span>{telemetry.cacheHitAverage.toFixed(1)}%</span>
                </div>
              )}
            </div>
          )}
          {/* The session's MCP servers, below the context numbers: one popover
              for "what this chat is running with", and the switch is per
              session because the list is a spawn property. */}
          <McpSection sessionId={sessionId} />
        </AnchoredMenu>
      )}
    </>
  );
}
