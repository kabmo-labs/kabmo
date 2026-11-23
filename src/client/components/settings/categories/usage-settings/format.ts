/** Pure formatters for the Settings → Usage panel. */

const rupiahFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('id-ID');

const compactDecimalFormatter = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

const dateTimeFormatter = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const dateFormatter = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' });

export function formatRp(value: number): string {
  return rupiahFormatter.format(value);
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/** Formats an RFC 3339 timestamp in the local timezone; falls back to the raw string. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return dateTimeFormatter.format(date);
}

/**
 * The date alone, for a reset that is days away and needs no clock time. Derived
 * from its own formatter rather than by cutting `formatDateTime` at a comma: the
 * comma position is locale data, and en-US puts the year after it.
 */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return dateFormatter.format(date);
}

/** Percentage of `used` out of `total`, clamped to 0–100 for progress bars. */
export function usedPercent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

export function formatPercent(used: number, total: number): string {
  if (total <= 0) return '0%';
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format((used / total) * 100)}%`;
}

/** Compact token counts: 1124214260 → "1,12B"; 747642928 → "747,64M"; 61950 → "61,95K"; 950 → "950". */
export function formatCompactTokens(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${compactDecimalFormatter.format(value / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${compactDecimalFormatter.format(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${compactDecimalFormatter.format(value / 1_000)}K`;
  return formatNumber(value);
}

/** Formats a numeric string returned by the DeepSeek balance API. */
export function formatAmount(value: string): string {
  const parsed = Number(value);
  if (value.trim() === '' || !Number.isFinite(parsed)) return value;
  return formatNumber(parsed);
}

const usdFormatter = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** USD amounts from provider reports and local cost records. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '$0,00';
  return `$${usdFormatter.format(value)}`;
}

/**
 * Render one quota amount in its own unit. `percent` amounts arrive as 0..100
 * (omp's `used`/`limit` for percent units), everything else as a raw count.
 */
export function formatUsageAmount(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  switch (unit) {
    case 'percent':
      return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value)}%`;
    case 'usd':
      return formatUsd(value);
    case 'tokens':
    case 'bytes':
      return formatCompactTokens(value);
    default:
      return formatNumber(value);
  }
}

/** Fraction (0..1) rendered as a whole-percent string. */
export function formatFractionPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '0%';
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(fraction * 100)}%`;
}
