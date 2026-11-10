/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The usage numbers an ACP session reports.
 *
 * ACP sends `usage_update` with the context window, the tokens in use and a
 * cost — no per-turn input/output split. This keeps the latest snapshot for the
 * panels, and a per-turn peak summed into `usageTokens` so the goal budget has a
 * measured figure to enforce. All of it is best-effort: an agent that never
 * reports usage leaves every value at zero.
 */

export interface AcpContextUsage {
  tokens: number;
  contextWindow: number;
  percent: number;
}

export class AcpUsageMeter {
  contextUsage: AcpContextUsage | null = null;
  totalCost = 0;
  /** Context tokens across completed turns (peak `used` per turn, summed). */
  usageTokens = 0;
  private turnPeak = 0;

  beginTurn(): void {
    this.turnPeak = 0;
  }

  absorb(update: Record<string, unknown>): void {
    const size = typeof update.size === 'number' ? update.size : undefined;
    const used = typeof update.used === 'number' ? update.used : undefined;
    if (size !== undefined && used !== undefined && size > 0) {
      this.contextUsage = {
        tokens: used,
        contextWindow: size,
        percent: Math.min(100, Math.max(0, Math.round((used / size) * 100))),
      };
      this.turnPeak = Math.max(this.turnPeak, used);
    }
    const cost = update.cost;
    if (cost === null) {
      this.totalCost = 0;
      return;
    }
    if (cost && typeof cost === 'object' && 'amount' in cost && typeof cost.amount === 'number') {
      this.totalCost = cost.amount;
    }
  }

  endTurn(): void {
    this.usageTokens += this.turnPeak;
    this.turnPeak = 0;
  }

  /** A new goal's budget counts from its own creation, not the chat's past. */
  reset(): void {
    this.usageTokens = 0;
    this.turnPeak = 0;
  }
}
