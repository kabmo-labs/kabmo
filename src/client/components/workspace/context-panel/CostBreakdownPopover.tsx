
import { useRef } from 'preact/hooks';
import { X } from 'lucide-preact';
import type { ContextCostBreakdown } from '@/shared/types/context';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';

interface CostBreakdownPopoverProps {
  open: boolean;
  onClose: () => void;
  breakdown?: ContextCostBreakdown;
  costFormatted?: string;
}

function money(value: number): string {
  return value < 0.01 ? '$0.01' : `$${value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
}

export function CostBreakdownPopover({
  open,
  onClose,
  breakdown,
  costFormatted,
}: CostBreakdownPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useOnClickOutside(ref, onClose);

  if (!open) return null;

  const rows = breakdown
    ? [
        { label: 'Total Cost', value: money(breakdown.total), strong: true },
        { label: 'Input (cache miss)', value: money(breakdown.input) },
        { label: 'Output', value: money(breakdown.output) },
        { label: 'Cache Read (cache hit)', value: money(breakdown.cacheRead) },
        { label: 'Cache Write', value: money(breakdown.cacheWrite) },
      ]
    : [{ label: 'Total Cost', value: costFormatted ?? '$0.01', strong: true }];

  return (
    <div
      ref={ref}
      className="glass-popover absolute top-full right-0 mt-1.5 z-50 w-64 bg-paper border border-ink/10 rounded-lg shadow-lg p-3"
      role="dialog"
      aria-modal="false"
    >
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-xs font-semibold text-ink tracking-tight">Cost Breakdown</span>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-ink/5 text-ink/60 hover:text-ink transition-colors"
          aria-label="Close cost breakdown"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-1.5">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between text-[11px] font-mono border-b border-ink/5 last:border-0 pb-1.5 last:pb-0"
          >
            <span className="text-ink/60">{row.label}</span>
            <span className={`${row.strong ? 'font-semibold text-ink' : 'text-ink/80'}`}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
