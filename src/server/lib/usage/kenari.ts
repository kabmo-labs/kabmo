import { resolveKenariApiKey } from '@/server/lib/usage/provider-key';
import type { KenariBalance, KenariCoupon, KenariQuota, KenariQuotaWindow, KenariUsage, KenariUsageReport, KenariUsageRow } from '@/shared/types';
import { isRecord } from '@/shared/lib/util/guards';

const FETCH_TIMEOUT_MS = 10_000;
const QUOTA_URL = 'https://kenari.id/v1/account/quota';
const MCP_URL = 'https://kenari.id/mcp';
// Cloudflare blocks the /mcp path with error 1010 when the request carries a
// default fetch User-Agent; an explicit one is required (verified).
const USER_AGENT = 'kabmo/1.0 (+https://kenari.id/docs/agents)';

/**
 * Parse an Indonesian Rupiah amount: "Rp" followed by digits where `.` is the
 * thousands separator and `,` the decimal separator ("Rp 76.514" → 76514,
 * "Rp 1.234,56" → 1234.56). Returns null when no Rupiah amount is present.
 */
function parseRupiah(text: string): number | null {
  const match = text.match(/Rp\s*([0-9][0-9.,]*)/i);
  if (!match) return null;
  const raw = match[1];
  const commaIndex = raw.indexOf(',');
  const normalized = commaIndex >= 0
    ? raw.slice(0, commaIndex).replace(/\./g, '') + '.' + raw.slice(commaIndex + 1).replace(/\./g, '')
    : raw.replace(/\./g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

const WINDOW_DEFS: Array<{ key: KenariQuotaWindow['key']; label: string; field: string }> = [
  { key: 'five_hour', label: '5 hours', field: 'five_hour' },
  { key: 'week', label: 'Weekly', field: 'week' },
  { key: 'month', label: 'Monthly', field: 'month' },
];

function mapQuota(payload: unknown): KenariQuota {
  if (!isRecord(payload)) throw new Error('Unexpected quota response format');
  const plan = isRecord(payload.plan) ? payload.plan : null;
  const planName = plan && typeof plan.name === 'string' ? plan.name : null;

  const windows: KenariQuotaWindow[] = [];
  if (plan && isRecord(plan.windows)) {
    for (const def of WINDOW_DEFS) {
      const window = plan.windows[def.field];
      if (!isRecord(window)) continue;
      windows.push({
        key: def.key,
        label: def.label,
        usedRp: toNumber(window.used_rp),
        remainingRp: toNumber(window.remaining_rp),
        resetsAt: typeof window.resets_at === 'string' ? window.resets_at : '',
      });
    }
  }

  let coupon: KenariCoupon | null = null;
  const couponRaw = payload.coupon;
  if (isRecord(couponRaw)) {
    const scopeModels = Array.isArray(couponRaw.scope_models)
      ? couponRaw.scope_models.filter((model): model is string => typeof model === 'string')
      : [];
    const remainingRaw = couponRaw.remaining_rp;
    coupon = {
      name: typeof couponRaw.name === 'string' ? couponRaw.name : '',
      usedRp: toNumber(couponRaw.used_rp),
      remainingRp: remainingRaw === null || remainingRaw === undefined ? null : toNumber(remainingRaw),
      expiresAt: typeof couponRaw.expires_at === 'string' ? couponRaw.expires_at : '',
      scopeModels,
    };
  }

  return { planName, windows, coupon };
}

async function fetchKenariQuota(apiKey: string): Promise<KenariQuota> {
  const response = await fetch(QUOTA_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 403) {
    const body: unknown = await response.json().catch(() => null);
    if (isRecord(body) && body.code === 'shared_key_not_allowed') {
      throw new Error('This key is a shared key; balance/usage/quota require the account owner key.');
    }
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`);
  }
  return mapQuota(await response.json());
}

/** Extract the first JSON `data:` line from a `text/event-stream` body. */
function parseSseData(text: string): unknown {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice('data:'.length).trim();
    if (data.length === 0 || data === '[DONE]') continue;
    try {
      return JSON.parse(data);
    } catch {
      // Malformed data line — keep scanning.
    }
  }
  return null;
}

/**
 * Pull the tool result text from a JSON-RPC `tools/call` response. A JSON-RPC
 * error is surfaced as an Error carrying its `error.message`.
 */
function extractToolText(payload: unknown): string {
  if (!isRecord(payload)) throw new Error('Unexpected MCP response format');
  if (isRecord(payload.error)) {
    const message = typeof payload.error.message === 'string'
      ? payload.error.message
      : 'MCP tool call failed';
    throw new Error(message);
  }
  const result = payload.result;
  if (!isRecord(result)) throw new Error('Unexpected MCP response format');
  if (!Array.isArray(result.content)) throw new Error('Unexpected MCP response format');
  for (const item of result.content) {
    if (isRecord(item) && typeof item.text === 'string') return item.text;
  }
  throw new Error('Unexpected MCP response format');
}

/**
 * Call a stateless Kenari MCP tool. A direct `tools/call` works without an
 * `initialize` handshake (the server is stateless, verified).
 */
async function callKenariTool(apiKey: string, toolName: string): Promise<string> {
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: {} },
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('text/event-stream')
    ? parseSseData(await response.text())
    : await response.json();
  return extractToolText(payload);
}

async function fetchKenariBalance(apiKey: string): Promise<KenariBalance> {
  const raw = await callKenariTool(apiKey, 'kenari_balance');
  return { amountRp: parseRupiah(raw), raw };
}

function toInt(value: string): number {
  const parsed = Number.parseInt(value.replace(/[.,]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Parse the kenari_usage Markdown table + trailing "Total:" line. */
function parseUsageText(raw: string): KenariUsage {
  const rows: KenariUsageRow[] = [];
  let totalRequests = 0;
  let totalCostRp = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|')) {
      const cells = trimmed.split('|').map((cell) => cell.trim()).filter((cell) => cell.length > 0);
      if (cells.length < 5) continue;
      const model = cells[0];
      if (model === 'model' || /^-+$/.test(model)) continue;
      rows.push({
        model,
        requests: toInt(cells[1]),
        inputTokens: toInt(cells[2]),
        outputTokens: toInt(cells[3]),
        costRp: parseRupiah(cells[4]) ?? 0,
      });
      continue;
    }
    const totalMatch = trimmed.match(/Total:\s*([0-9][0-9.,]*)\s*request/i);
    if (totalMatch) {
      totalRequests = toInt(totalMatch[1]);
      totalCostRp = parseRupiah(trimmed) ?? 0;
    }
  }
  return { rows, totalRequests, totalCostRp, raw };
}

async function fetchKenariUsage(apiKey: string): Promise<KenariUsage> {
  const raw = await callKenariTool(apiKey, 'kenari_usage');
  return parseUsageText(raw);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Build the Kenari usage report for ONE provider slug, or `null` when that
 * provider has no credential — the caller then omits it. The slug is what keeps
 * a second Kenari account (`kenari2`) on its own key: both accounts share the
 * same upstream endpoints, so only the credential decides whose quota is read.
 * The three upstream calls (quota REST + two MCP tools) run independently so a
 * failure in one does not lose the others; failures are folded into the
 * report's `error`.
 */
export async function buildKenariReport(slug: string): Promise<KenariUsageReport | null> {
  const apiKey = await resolveKenariApiKey(slug);
  if (!apiKey) return null;

  const report: KenariUsageReport = {};
  const [quota, balance, usage] = await Promise.allSettled([
    fetchKenariQuota(apiKey),
    fetchKenariBalance(apiKey),
    fetchKenariUsage(apiKey),
  ]);

  const errors: string[] = [];
  if (quota.status === 'fulfilled') {
    report.quota = quota.value;
  } else {
    errors.push(errorMessage(quota.reason, 'Failed to load quota'));
  }
  if (balance.status === 'fulfilled') {
    report.balance = balance.value;
  } else {
    errors.push(errorMessage(balance.reason, 'Failed to load balance'));
  }
  if (usage.status === 'fulfilled') {
    report.usage = usage.value;
  } else {
    errors.push(errorMessage(usage.reason, 'Failed to load usage'));
  }
  if (errors.length > 0) report.error = errors.join(' · ');
  return report;
}
