import type { BreakdownRow, BreakdownTab, CadenceType, ChartSeriesPoint, TimeRangeOption, TimeRangeType, TokenUsageMetricSet } from '@/shared/types';

export const TIME_RANGES: TimeRangeOption[] = [
  { id: 'today', label: 'Today', dateRange: 'Sep 7, 2026' },
  { id: '7d', label: 'Last 7 days', dateRange: 'Sep 1 to Sep 7' },
  { id: '30d', label: 'Last 30 days', dateRange: 'Aug 8 to Sep 7' },
  { id: '90d', label: 'Last 90 days', dateRange: 'Jun 9 to Sep 7' },
  { id: 'all', label: 'All time', dateRange: 'Jan 1 to Sep 7' },
  { id: 'custom', label: 'Custom…', dateRange: 'Custom period' },
];

export const MOCK_RANGE_DATA: Record<Exclude<TimeRangeType, 'custom'>, TokenUsageMetricSet> = {
  today: {
    rawCost: '$0.01',
    processedTokens: '320K',
    activeRate: '320K per active day',
    cachedInput: '275K',
    cachedPercent: '85.9% of observed input',
    uncachedInput: '38.2K',
    outputTokens: '6.8K',
    reasoning: 'includes 2.9K reasoning',
    cacheSavings: '$0.00',
    scannedTranscripts: 3,
    usageRecords: 14,
  },
  '7d': {
    rawCost: '$0.04',
    processedTokens: '1.24M',
    activeRate: '248K per active day',
    cachedInput: '1.08M',
    cachedPercent: '87.0% of observed input',
    uncachedInput: '142.5K',
    outputTokens: '17.5K',
    reasoning: 'includes 7.1K reasoning',
    cacheSavings: '$0.00',
    scannedTranscripts: 7,
    usageRecords: 38,
  },
  '30d': {
    rawCost: '$0.10',
    processedTokens: '3.08M',
    activeRate: '1.54M per active day',
    cachedInput: '2.65M',
    cachedPercent: '87.2% of observed input',
    uncachedInput: '390.7K',
    outputTokens: '34.1K',
    reasoning: 'includes 14.5K reasoning',
    cacheSavings: '$0.00',
    scannedTranscripts: 12,
    usageRecords: 78,
  },
  '90d': {
    rawCost: '$0.38',
    processedTokens: '11.4M',
    activeRate: '1.42M per active day',
    cachedInput: '9.82M',
    cachedPercent: '86.1% of observed input',
    uncachedInput: '1.34M',
    outputTokens: '240K',
    reasoning: 'includes 102K reasoning',
    cacheSavings: '$0.00',
    scannedTranscripts: 34,
    usageRecords: 215,
  },
  all: {
    rawCost: '$1.24',
    processedTokens: '38.6M',
    activeRate: '1.28M per active day',
    cachedInput: '33.1M',
    cachedPercent: '85.7% of observed input',
    uncachedInput: '4.82M',
    outputTokens: '680K',
    reasoning: 'includes 294K reasoning',
    cacheSavings: '$0.00',
    scannedTranscripts: 89,
    usageRecords: 642,
  },
};

export const BREAKDOWN_DATA: Record<BreakdownTab, BreakdownRow[]> = {
  model: [
    { name: 'deepseek-v4-flash', cost: '$0.06', share: '63.7%', tokens: '2.0M', sharePercent: 63.7, dotColorClass: 'bg-ink/80' },
    { name: 'deepseek-v4-flash-vi...', cost: '$0.03', share: '28.0%', tokens: '1.0M', sharePercent: 28.0, dotColorClass: 'bg-ink/50' },
    { name: 'deepseek-v4-pro', cost: '$0.008', share: '8.3%', tokens: '18K', sharePercent: 8.3, dotColorClass: 'bg-transparent border border-ink/40' },
  ],
  day: [
    { name: 'Sep 07 (Today)', cost: '$0.054', share: '54.0%', tokens: '1.8M', sharePercent: 54.0, dotColorClass: 'bg-ink/80' },
    { name: 'Sep 06', cost: '$0.032', share: '32.0%', tokens: '950K', sharePercent: 32.0, dotColorClass: 'bg-ink/50' },
    { name: 'Sep 05', cost: '$0.014', share: '14.0%', tokens: '330K', sharePercent: 14.0, dotColorClass: 'bg-transparent border border-ink/40' },
  ],
  project: [
    { name: 'kabmo-core', cost: '$0.068', share: '68.0%', tokens: '2.1M', sharePercent: 68.0, dotColorClass: 'bg-ink/80' },
    { name: 'agent-runner', cost: '$0.022', share: '22.0%', tokens: '680K', sharePercent: 22.0, dotColorClass: 'bg-ink/50' },
    { name: 'remis-edge-runtime', cost: '$0.010', share: '10.0%', tokens: '300K', sharePercent: 10.0, dotColorClass: 'bg-transparent border border-ink/40' },
  ],
};

const point = (label: string, cost: number, tokens: number): ChartSeriesPoint => ({ label, cost, tokens });

export const MOCK_CUSTOM_RANGE_DATA: TokenUsageMetricSet = {
  rawCost: '$0.07',
  processedTokens: '2.16M',
  activeRate: '9 active days',
  cachedInput: '1.86M',
  cachedPercent: '86.1% of observed input',
  uncachedInput: '271.4K',
  outputTokens: '24.3K',
  reasoning: 'includes 10.2K reasoning',
  cacheSavings: '$0.00',
  scannedTranscripts: 9,
  usageRecords: 57,
};

export const MOCK_CHART_SERIES: Record<CadenceType, ChartSeriesPoint[]> = {
  daily: [
    point('Aug 8', 0.004, 210_000), point('Aug 11', 0.002, 95_000), point('Aug 14', 0.008, 310_000),
    point('Aug 17', 0.003, 150_000), point('Aug 20', 0.011, 420_000), point('Aug 23', 0.005, 240_000),
    point('Aug 26', 0.007, 330_000), point('Aug 29', 0.014, 560_000), point('Sep 1', 0.006, 280_000),
    point('Sep 4', 0.016, 640_000), point('Sep 7', 0.024, 880_000),
  ],
  weekly: [
    point('Aug 10', 0.014, 520_000), point('Aug 17', 0.019, 760_000), point('Aug 24', 0.026, 1_120_000),
    point('Aug 31', 0.031, 1_380_000), point('Sep 7', 0.052, 2_290_000),
  ],
  monthly: [
    point('Jun', 0.081, 3_120_000), point('Jul', 0.148, 5_640_000), point('Aug', 0.512, 16_860_000),
    point('Sep', 0.499, 12_980_000),
  ],
};
