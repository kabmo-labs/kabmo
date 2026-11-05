import { DollarSign } from 'lucide-preact';

interface PriceFieldsProps {
  costInput: string;
  costOutput: string;
  costCacheRead: string;
  costCacheWrite: string;
  onCostInputChange: (value: string) => void;
  onCostOutputChange: (value: string) => void;
  onCostCacheReadChange: (value: string) => void;
  onCostCacheWriteChange: (value: string) => void;
  error?: string;
}

/** One labelled price box. `hint` distinguishes the four rates. */
function PriceField({
  value,
  onChange,
  label,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  hint: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-ink/70 mb-1" title={hint}>
        {label}
      </label>
      <div className="relative flex items-center">
        <DollarSign size={12} className="absolute left-2.5 text-ink/40 pointer-events-none" />
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          placeholder="0"
          className="w-full bg-paper border border-ink/20 rounded-md pl-7 pr-2 py-1.5 text-xs text-ink outline-none focus:border-ink/60 font-mono"
        />
      </div>
    </div>
  );
}

/**
 * The four `models.yml` cost rates, in USD per 1M tokens.
 *
 * omp requires all four fields together, so input/output are the pair that
 * decides whether a price is written at all; the two cache rates then default
 * to 0, which is the honest value for "no cached-token discount". Cache rates
 * matter for accounting rather than routing: without them every cached turn is
 * billed at the full input rate, which is why they are worth asking for
 * separately instead of deriving from input.
 */
export function PriceFields({
  costInput,
  costOutput,
  costCacheRead,
  costCacheWrite,
  onCostInputChange,
  onCostOutputChange,
  onCostCacheReadChange,
  onCostCacheWriteChange,
  error,
}: PriceFieldsProps) {
  return (
    <div>
      <label className="block text-xs font-semibold text-ink mb-1.5">
        Price <span className="font-normal text-ink/40">(USD per 1M tokens, optional)</span>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <PriceField
          value={costInput}
          onChange={onCostInputChange}
          label="Input"
          hint="Uncached prompt tokens"
        />
        <PriceField
          value={costOutput}
          onChange={onCostOutputChange}
          label="Output"
          hint="Generated tokens"
        />
        <PriceField
          value={costCacheRead}
          onChange={onCostCacheReadChange}
          label="Cache read"
          hint="Prompt tokens served from the provider's cache — usually a fraction of the input rate"
        />
        <PriceField
          value={costCacheWrite}
          onChange={onCostCacheWriteChange}
          label="Cache write"
          hint="Prompt tokens written into the provider's cache"
        />
      </div>
      {error && <p className="text-[11px] text-error mt-1">{error}</p>}
      <p className="text-[10px] text-ink/40 mt-1">
        Used for omp's cost accounting. Input and output decide whether a price is
        written at all; the cache rates fall back to 0, which bills cached turns at
        the full input rate.
      </p>
    </div>
  );
}
