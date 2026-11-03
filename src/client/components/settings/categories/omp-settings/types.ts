/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/** Live engine snapshot from `GET /api/omp/state`. */
export interface EngineState {
  model?: { provider?: string; id?: string };
  contextUsage?: { tokens?: number; contextWindow?: number; percent?: number } | null;
  fastModeEnabled?: boolean;
  thinkingLevel?: string;
  tokensPerSecond?: number;
}

/** One module found under `.omp/extensions`. */
export interface ExtensionItem {
  id: string;
  name: string;
  sourceRoot: string;
  filePath: string;
  disabled: boolean;
}

/** The outcome every settings write reports, so a refusal is never silent. */
export interface WriteOutcome {
  ok: boolean;
  error?: string;
}
