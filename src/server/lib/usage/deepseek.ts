import { resolveDeepSeekApiKey } from '@/server/lib/usage/provider-key';
import type { DeepSeekBalance, DeepSeekBalanceEntry, DeepSeekUsageReport } from '@/shared/types';
import { isRecord } from '@kabmo-labs/kabmo-guards';

const FETCH_TIMEOUT_MS = 10_000;
const BALANCE_URL = 'https://api.deepseek.com/user/balance';

function toString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function mapBalance(payload: unknown): DeepSeekBalance {
  if (!isRecord(payload)) throw new Error('Unexpected DeepSeek response format');
  const infos = Array.isArray(payload.balance_infos) ? payload.balance_infos : [];
  const entries: DeepSeekBalanceEntry[] = [];
  for (const info of infos) {
    if (!isRecord(info)) continue;
    entries.push({
      currency: typeof info.currency === 'string' ? info.currency : '',
      totalBalance: toString(info.total_balance),
      grantedBalance: toString(info.granted_balance),
      toppedUpBalance: toString(info.topped_up_balance),
    });
  }
  return { isAvailable: payload.is_available === true, entries };
}

// DeepSeek exposes no public usage/quota API — only its web console tracks
// spend. The Settings → Usage panel states this for the DeepSeek section;
// here we can only report the prepaid balance.
async function fetchDeepSeekBalance(apiKey: string): Promise<DeepSeekBalance> {
  const response = await fetch(BALANCE_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 401) {
    throw new Error('Invalid DeepSeek API key.');
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`);
  }
  return mapBalance(await response.json());
}

/** Build the DeepSeek usage report, or `null` when DeepSeek has no credential. */
export async function buildDeepSeekReport(): Promise<DeepSeekUsageReport | null> {
  const apiKey = await resolveDeepSeekApiKey();
  if (!apiKey) return null;
  try {
    return { balance: await fetchDeepSeekBalance(apiKey) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Failed to load DeepSeek balance',
    };
  }
}
