export interface ContextTokenBreakdown {
  total: number;
  input: number;
  output: number;
  reasoning: number;
  cache: {
    write: number;
    read: number;
  };
}

export interface RawMessageInfo {
  id: string;
  parentID?: string;
  role: 'user' | 'assistant' | 'system';
  mode?: string;
  agent?: string;
  path?: {
    cwd: string;
    root: string;
  };
  cost: number;
  tokens: ContextTokenBreakdown;
  modelID: string;
  contentSnippet?: string;
  toolSummary?: string;
  timestamp?: string;
}

export interface RawMessageItem {
  id: string;
  type: string;
  badgeLabel: string;
  tokenSummary: string;
  timestamp: string;
  info: RawMessageInfo;
  rawPayload: Record<string, any>;
}

export interface ContextCostBreakdown {
  /** Fresh (uncached) prompt cost — often labelled "cache miss". */
  input: number;
  output: number;
  /** Served-from-cache cost — labelled "cache hit". */
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

/** Measured run timing for a session. Absent fields mean the source never
 *  reported them: an ACP chat sends no per-call timing, and transcripts that
 *  predate `ttft` have no first-token clock. */
export interface SessionTimingStats {
  /** Summed request duration of every assistant call, ms (TTFT included). */
  llmMs: number;
  /** Summed wall time of every tool call that has both ends in the file, ms. */
  toolMs: number;
  /** Mean time to first token across calls that reported one, ms. */
  ttftAvgMs?: number;
  /** Output tokens per second of the last completed call. */
  lastTps?: number;
  /** Output tokens per second over the whole session (output / LLM time). */
  avgTps?: number;
}

export interface SessionContextTelemetry {
  sessionId: string;
  sessionTitle: string;
  modelId: string;
  modelName: string;
  timestamp: string;
  contextUsed: number;
  contextLimit: number;
  contextPercent: number;
  messagesCount: number;
  userCount: number;
  assistantCount: number;
  totalCost: number;
  costFormatted: string;
  /** Measured turns/steps/LLM/tool timing; absent when the source has none. */
  timing?: SessionTimingStats;
  /** Average cache-hit rate (%) across assistant turns. */
  cacheHitAverage?: number;
  /** Per-category cost breakdown for the cost detail popup. */
  costBreakdown?: ContextCostBreakdown;
  lastMessage: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    cacheHitPercent: number;
  };
  distribution: {
    userTokens: number;
    userPercent: number;
    assistantTokens: number;
    assistantPercent: number;
    toolTokens: number;
    toolPercent: number;
    otherTokens: number;
    otherPercent: number;
  };
  rawMessages: RawMessageItem[];
}
