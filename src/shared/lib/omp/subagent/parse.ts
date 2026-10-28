/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Lenient parsers + roster fold for oh-my-pi subagent frames and snapshots.
 * Defensive by design: unknown statuses / malformed payloads must never
 * fabricate a live roster entry. Wire shapes live in `@/types/omp/subagent`.
 */

import { isRecord } from '@/shared/lib/util/guards';
import type { SubagentActivityEvent, SubagentAgentSource, SubagentInfo, SubagentProgress, SubagentSnapshotLike } from '@/shared/types/omp/subagent';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asAgentSource(value: unknown): SubagentAgentSource | undefined {
  return value === 'bundled' || value === 'user' || value === 'project' ? value : undefined;
}

function asProgressStatus(value: unknown): SubagentProgress['status'] | undefined {
  return value === 'pending' || value === 'running' || value === 'completed' || value === 'failed' || value === 'aborted'
    ? value
    : undefined;
}

/** Defensively copy an AgentProgress-shaped object into a SubagentProgress. */
export function parseSubagentProgress(value: unknown): SubagentProgress | undefined {
  if (!isRecord(value)) return undefined;
  const out: SubagentProgress = {};
  const index = asNumber(value.index);
  if (index !== undefined) out.index = index;
  const id = asString(value.id);
  if (id !== undefined) out.id = id;
  const agent = asString(value.agent);
  if (agent !== undefined) out.agent = agent;
  const agentSource = asAgentSource(value.agentSource);
  if (agentSource !== undefined) out.agentSource = agentSource;
  const status = asProgressStatus(value.status);
  if (status !== undefined) out.status = status;
  const task = asString(value.task);
  if (task !== undefined) out.task = task;
  const assignment = asString(value.assignment);
  if (assignment !== undefined) out.assignment = assignment;
  const description = asString(value.description);
  if (description !== undefined) out.description = description;
  const lastIntent = asString(value.lastIntent);
  if (lastIntent !== undefined) out.lastIntent = lastIntent;
  const currentTool = asString(value.currentTool);
  if (currentTool !== undefined) out.currentTool = currentTool;
  const currentToolArgs = asString(value.currentToolArgs);
  if (currentToolArgs !== undefined) out.currentToolArgs = currentToolArgs;
  const currentToolStartMs = asNumber(value.currentToolStartMs);
  if (currentToolStartMs !== undefined) out.currentToolStartMs = currentToolStartMs;
  if (Array.isArray(value.recentTools)) out.recentTools = value.recentTools as SubagentProgress['recentTools'];
  if (Array.isArray(value.recentOutput)) out.recentOutput = value.recentOutput.filter((x): x is string => typeof x === 'string');
  const toolCount = asNumber(value.toolCount);
  if (toolCount !== undefined) out.toolCount = toolCount;
  const requests = asNumber(value.requests);
  if (requests !== undefined) out.requests = requests;
  const tokens = asNumber(value.tokens);
  if (tokens !== undefined) out.tokens = tokens;
  const contextTokens = asNumber(value.contextTokens);
  if (contextTokens !== undefined) out.contextTokens = contextTokens;
  const contextWindow = asNumber(value.contextWindow);
  if (contextWindow !== undefined) out.contextWindow = contextWindow;
  const cost = asNumber(value.cost);
  if (cost !== undefined) out.cost = cost;
  const durationMs = asNumber(value.durationMs);
  if (durationMs !== undefined) out.durationMs = durationMs;
  if (typeof value.modelOverride === 'string' || (Array.isArray(value.modelOverride) && value.modelOverride.every((x) => typeof x === 'string'))) {
    out.modelOverride = value.modelOverride;
  }
  const modelRole = asString(value.modelRole);
  if (modelRole !== undefined) out.modelRole = modelRole;
  const resolvedModel = asString(value.resolvedModel);
  if (resolvedModel !== undefined) out.resolvedModel = resolvedModel;
  const resolvedThinkingLevel = asString(value.resolvedThinkingLevel);
  if (resolvedThinkingLevel !== undefined) out.resolvedThinkingLevel = resolvedThinkingLevel;
  if (typeof value.resolvedModelIsFallback === 'boolean') out.resolvedModelIsFallback = value.resolvedModelIsFallback;
  if (isRecord(value.retryState)) {
    const attempt = asNumber(value.retryState.attempt);
    const maxAttempts = asNumber(value.retryState.maxAttempts);
    const delayMs = asNumber(value.retryState.delayMs);
    const errorMessage = asString(value.retryState.errorMessage);
    const startedAtMs = asNumber(value.retryState.startedAtMs);
    // All fields are documented as required upstream; fabricating defaults for
    // a partial frame would render a false "retrying" state.
    if (attempt !== undefined && maxAttempts !== undefined && delayMs !== undefined && errorMessage !== undefined && startedAtMs !== undefined) {
      out.retryState = { attempt, maxAttempts, delayMs, errorMessage, startedAtMs };
    }
  }
  if (isRecord(value.retryFailure)) {
    const attempt = asNumber(value.retryFailure.attempt);
    const errorMessage = asString(value.retryFailure.errorMessage);
    if (attempt !== undefined && errorMessage !== undefined) {
      out.retryFailure = { attempt, errorMessage };
    }
  }
  if (value.inflightTaskDetails !== undefined) out.inflightTaskDetails = value.inflightTaskDetails;
  if (isRecord(value.extractedToolData)) out.extractedToolData = value.extractedToolData as Record<string, unknown[]>;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Map a get_subagents snapshot to roster form. */
export function parseSubagentSnapshot(value: unknown): SubagentInfo | undefined {
  if (!isRecord(value)) return undefined;
  const id = asString(value.id);
  const agent = asString(value.agent);
  if (!id || !agent) return undefined;
  let status: SubagentInfo['status'];
  if (value.status === 'started' || value.status === 'completed' || value.status === 'failed' || value.status === 'aborted') {
    status = value.status;
  } else if (value.status === 'pending' || value.status === 'running') {
    status = 'started';
  } else {
    // Unknown/future lifecycle status — a malformed frame must not fabricate a
    // live chip.
    return undefined;
  }
  const info: SubagentInfo = {
    id,
    agent,
    status,
    index: asNumber(value.index) ?? -1,
    source: 'live',
  };
  const agentSource = asAgentSource(value.agentSource);
  if (agentSource !== undefined) info.agentSource = agentSource;
  const description = asString(value.description);
  if (description !== undefined) info.description = description;
  const task = asString(value.task);
  if (task !== undefined) info.task = task;
  const assignment = asString(value.assignment);
  if (assignment !== undefined) info.assignment = assignment;
  const sessionFile = asString(value.sessionFile);
  if (sessionFile !== undefined) info.sessionFile = sessionFile;
  const parentToolCallId = asString(value.parentToolCallId);
  if (parentToolCallId !== undefined) info.parentToolCallId = parentToolCallId;
  // Snapshots without a wire-carried lastUpdate would be treated as
  // infinitely new by mergeSubagentRoster's skipNewerThan guard, letting
  // back-to-back stale snapshots regress terminal status — stamp read time.
  const lastUpdate = asNumber(value.lastUpdate) ?? Date.now();
  info.lastUpdate = lastUpdate;
  const progress = parseSubagentProgress(value.progress);
  if (progress !== undefined) info.progress = progress;
  return info;
}

/** Map a subagent_lifecycle frame to roster form. Stricter than a snapshot:
 * requires id + status, and unlike snapshots the wire may omit `agent` (it
 * defaults to "subagent"). Unknown statuses must not fabricate a live chip. */
export function parseSubagentLifecycle(value: unknown): SubagentInfo | undefined {
  if (!isRecord(value)) return undefined;
  const id = asString(value.id);
  const statusRaw = asString(value.status);
  if (!id || !statusRaw) return undefined;
  if (statusRaw !== 'started' && statusRaw !== 'completed' && statusRaw !== 'failed' && statusRaw !== 'aborted') return undefined;
  const info: SubagentInfo = {
    id,
    agent: asString(value.agent) ?? 'subagent',
    status: statusRaw,
    index: asNumber(value.index) ?? -1,
    lastUpdate: Date.now(),
    source: 'live',
  };
  const agentSource = asAgentSource(value.agentSource);
  if (agentSource !== undefined) info.agentSource = agentSource;
  const description = asString(value.description);
  if (description !== undefined) info.description = description;
  const sessionFile = asString(value.sessionFile);
  if (sessionFile !== undefined) info.sessionFile = sessionFile;
  const parentToolCallId = asString(value.parentToolCallId);
  if (parentToolCallId !== undefined) info.parentToolCallId = parentToolCallId;
  if (typeof value.detached === 'boolean') info.detached = value.detached;
  return info;
}

/**
 * Read a progress frame's payload: `SubagentProgressPayload` nests the
 * AgentProgress it reports under `progress`, while a bare AgentProgress (and a
 * `get_subagents` snapshot's own field) is the object itself. Both shapes reach
 * the same listeners, so unwrap here rather than at each call site — the outer
 * wrapper's `id`/`index` fill in what the nested snapshot omits.
 */
export function readSubagentProgressFrame(payload: unknown): SubagentProgress | undefined {
  const direct = parseSubagentProgress(payload);
  if (!isRecord(payload) || !isRecord(payload.progress)) return direct;
  const nested = parseSubagentProgress(payload.progress);
  if (!nested) return direct;
  return { ...nested, id: nested.id ?? direct?.id, index: nested.index ?? direct?.index };
}

/** Extract a compact live-activity entry from a subagent_event payload. */
export function parseSubagentActivityEvent(value: unknown): SubagentActivityEvent | null {
  if (!isRecord(value)) return null;
  const event = isRecord(value.event) ? value.event : null;
  if (!event) return null;
  const type = asString(event.type);
  const ts = Date.now();
  if (type === 'tool_execution_start') {
    const toolName = asString(event.toolName) ?? 'tool';
    const intent = asString(event.intent)?.trim();
    if (intent) return { kind: 'tool', label: `→ ${toolName} — ${intent}`, ts };
    const args = isRecord(event.args) ? Object.keys(event.args).slice(0, 3).join(', ') : undefined;
    return { kind: 'tool', label: args ? `→ ${toolName} (${args})` : `→ ${toolName}`, ts };
  }
  if (type === 'message_end') {
    const message = isRecord(event.message) ? event.message : null;
    if (message && message.role === 'assistant') {
      const content = message.content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
            .filter((block): block is { type: 'text'; text?: unknown } => isRecord(block) && block.type === 'text')
            .map((block) => (typeof block.text === 'string' ? block.text : ''))
            .join('\n')
          : '';
      const trimmed = text.trim();
      if (trimmed) return { kind: 'text', label: trimmed.slice(0, 140), ts };
    }
  }
  if (type === 'notice') {
    const message = asString(event.message);
    if (message) return { kind: 'notice', label: message.slice(0, 140), ts };
  }
  return null;
}

/** Parse a get_subagents response body into roster entries. */
export function parseSubagentRosterResponse(value: unknown): SubagentInfo[] {
  if (!isRecord(value)) return [];
  const raw = value.subagents;
  if (!Array.isArray(raw)) return [];
  const out: SubagentInfo[] = [];
  for (const entry of raw) {
    const parsed = parseSubagentSnapshot(entry as SubagentSnapshotLike | unknown);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Ordinal for sorting: a batch the file has not recorded yet sorts last. */
const batchSeqOf = (subagent: SubagentInfo): number =>
  subagent.batchSeq ?? Number.MAX_SAFE_INTEGER;

/** Spawning call first, then position inside that call, then id. */
export function compareSubagents(a: SubagentInfo, b: SubagentInfo): number {
  return batchSeqOf(a) - batchSeqOf(b) || a.index - b.index || a.id.localeCompare(b.id);
}

/**
 * Fold roster entries into the previous list, ordered by spawning call and then
 * position within that call.
 *
 * Live frames win over on-disk history for the same id. `skipNewerThan` lets a
 * caller refuse to overwrite entries that live frames touched after a
 * point-in-time snapshot was requested, so a stale snapshot cannot regress a
 * child's terminal status.
 *
 * `batchSeq` is the one field that survives every precedence rule: only the
 * session file knows launch order, and the history entry carrying it is often
 * the one that loses to a newer live frame. A batch the file has not recorded
 * yet simply sorts last until the next history merge supplies its ordinal.
 */
export function mergeSubagentRoster(
  prev: SubagentInfo[],
  incoming: SubagentInfo[],
  skipNewerThan?: number,
): SubagentInfo[] {
  const byId = new Map(prev.map((subagent) => [subagent.id, subagent]));
  for (const entry of incoming) {
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
      continue;
    }
    const batchSeq = existing.batchSeq ?? entry.batchSeq;
    if (skipNewerThan !== undefined && (existing.lastUpdate ?? 0) >= skipNewerThan) {
      if (batchSeq !== existing.batchSeq) byId.set(entry.id, { ...existing, batchSeq });
      continue;
    }
    if (entry.source === 'history' && existing.source !== 'history') {
      if (batchSeq !== existing.batchSeq) byId.set(entry.id, { ...existing, batchSeq });
      continue;
    }
    if (entry.source !== 'history' && existing.source === 'history') {
      byId.set(entry.id, { ...entry, batchSeq });
      continue;
    }
    byId.set(entry.id, { ...existing, ...entry, batchSeq });
  }
  return [...byId.values()].sort(compareSubagents);
}
