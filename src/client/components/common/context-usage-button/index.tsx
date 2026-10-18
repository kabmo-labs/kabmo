/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
 * The popover is pinned to the viewport on the phone and anchored under the
 * trigger on the desktop; that is the only difference between the two, and it is
 * a prop rather than two components.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TargetedMouseEvent } from 'preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { useSessionContextTelemetry } from '@/client/hooks/chat/context/telemetry';
import { useModelNames } from '@/client/hooks/models/use-model-names';
import { useProviderNames } from '@/client/hooks/models/use-provider-names';
import { providerLabel } from '@/shared/lib/models/provider/label';
import { formatCompactTokens } from '@/shared/lib/format/number';
import { CONTEXT_BAND_TONES, contextUsageBand } from '@/shared/lib/chat/context/usage';
import { ContextRing } from '@/client/components/common/context-usage-button/Ring';

interface ContextUsageButtonProps {
  sessionId: string | null;
  /** `mobile` pins the popover to the phone's header geometry. */
  layout?: 'desktop' | 'mobile';
}

export function ContextUsageButton({ sessionId, layout = 'desktop' }: ContextUsageButtonProps) {
  const { telemetry, percent } = useSessionContextTelemetry(sessionId);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(containerRef, () => setOpen(false));

  // Escape closes the popover whether or not the pointer is over it; a panel
  // that can only be dismissed by clicking elsewhere is a trap on a keyboard.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

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
    ? 'w-8 h-8 rounded-lg hover:bg-ink/5 active:bg-ink/10 flex items-center justify-center transition-colors cursor-pointer'
    : 'p-1.5 rounded hover:bg-ink/10 transition-colors cursor-pointer';

  return (
    <div className="relative flex items-center" ref={containerRef}>
      <button
        type="button"
        onClick={(event: TargetedMouseEvent<HTMLElement>) => {
          event.stopPropagation();
          setOpen((previous) => !previous);
        }}
        className={triggerClass}
        title={started ? `Context usage — ${percent.toFixed(0)}% of the window` : 'Context usage — session not started'}
        aria-label="Context usage"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <ContextRing percent={percent} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Context usage"
          className={
            layout === 'mobile'
              ? 'fixed z-50 bg-paper border border-ink/20 rounded-xl shadow-xl p-3 text-xs font-mono'
              : 'absolute right-0 top-full z-50 mt-2 w-56 bg-paper border border-ink/20 rounded-xl shadow-xl p-3 text-xs font-mono'
          }
          style={
            layout === 'mobile'
              ? {
                  top: 'calc(3.5rem + env(safe-area-inset-top, 0px) + 0.375rem)',
                  right: 'max(0.75rem, env(safe-area-inset-right, 0px))',
                  width: '14rem',
                }
              : undefined
          }
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
                <span className="truncate text-right">{providerName || '—'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-ink/50 flex-shrink-0">Model:</span>
                <span className="truncate text-right">{modelName || '—'}</span>
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
        </div>
      )}
    </div>
  );
}
